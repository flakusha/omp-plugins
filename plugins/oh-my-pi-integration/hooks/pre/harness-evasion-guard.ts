// Harness-evasion guard (pre-hook).
//
// Stop-gap for rule `harness-tooling-discipline` part 3: agents may try to
// escape harness tooling via forms interception/rewrite usually misses —
// `command ls`, `builtin cat`, `bash -c "grep ..."`, or full paths like
// `/usr/bin/find`. Bypassing the interception layer defeats the tooling
// guarantees (structure-aware tools, context compression, output routing)
// and the reroute rules (read/grep/glob -> dedicated tools / lean-ctx MCP).
//
// Block with a pointer to the sanctioned path. Tool DISCOVERY via
// `which`/`command -v` is explicitly allowed — the rule mandates discovery;
// only command EXECUTION through evasion forms is blocked.
//
// Git mutating subcommands are command-grained (push/stash/reset --hard/
// clean -fd/branch -D/commit --amend), not binary-grained — adding `git`
// to INTERCEPTED would over-block `git status`/`git log`/`git diff`. The
// `*_GIT` patterns close the evasion-form holes that the bashInterceptor
// line-anchored regex misses (`bash -c "git push …"`, `command git stash …`,
// `/usr/bin/git push …`, and chained inner commands like
// `bash -c "cd /tmp && git push …"`).
//
// Two additional bypass shapes the original regex set does NOT cover and
// this module closes:
//
//   1. **Plain chained prefixes** — `cd /repo && git push …`,
//      `cd /tmp; git stash`, `set -e; git reset --hard`, `cd a | git push`,
//      `cd a || git push`. bashInterceptor anchors each pattern with `^\s*`,
//      so anything before the blocked token bypasses the whole match. The
//      `cd`/chained-prefix path executes the second segment anyway because
//      the bash tool runs the full string. We split on unquoted shell
//      separators (`&&`/`||`/`;`/`\n`/`|`) and run each segment through the
//      mutating-bin check (after normalizing the git global-option shape in
//      step 2) so the second segment cannot hide.
//
//   2. **`git -C / -c / --git-dir=` prefixes** — `git -C /repo push …`,
//      `git -c protocol.version=2 push …`, `git --git-dir=/x/.git push …`,
//      `git -c safe.directory='*' push …`. The `GIT_MUTATING` regex demands
//      `\bgit\s+<subcmd>` adjacency, so any global-option between `git` and
//      the subcommand bypasses detection. Strip those prefixes (consuming
//      their argument) before matching.
//
// Pathspec-scoped safe shapes (`git stash push -- <pathspec>`,
// `--include-untracked`) stay allowed — they cannot sweep other agents'
// in-flight work, mirroring the bashInterceptor rule.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/** Binaries with dedicated harness tools / interceptors (config.yml bashInterceptor). */
const INTERCEPTED = new Set([
  "ls",
  "cat",
  "grep",
  "rg",
  "ripgrep",
  "find",
  "fd",
  "sed",
  "awk",
  "sort",
  "uniq",
  "head",
  "tail",
  "wc",
  "diff",
  "less",
  "more",
]);

const BIN_ALT = [...INTERCEPTED].join("|");

// `command ls -la` (exec form). `command -v ls` is discovery: the regex
// requires the binary right after `command `, so a `-v` flag breaks the match.
const COMMAND_EXEC = new RegExp(`\\bcommand\\s+(${BIN_ALT})\\b`);
// `builtin cat x`
const BUILTIN_EXEC = new RegExp(`\\bbuiltin\\s+(${BIN_ALT})\\b`);
// `bash -c "grep x"` / `sh -c 'ls -la'` where the inner command starts with
// an intercepted binary. Env/sudo wrappers are accepted on BOTH sides:
//   `env bash -c "cat x"` — `env` before the shell
//   `bash -c "sudo cat x"` — `sudo` between `-c` and the inner binary
// `SHELL_C` only flags when the inner binary itself is intercepted; chain
// prefixes / `git push` etc. inside the inner string are caught by recursive
// `evasionReason` evaluation on the inner payload (see SHELL_STRING_FLAG).
const SHELL_C = new RegExp(
  `(?:(?:sudo|env|nohup)\\s+(?:-[a-zA-Z]+\\s+|\\S+\\s+)*)*(?:ba|z|d)?sh\\s+-c\\s+["']?\\s*(?:sudo\\s+|(?:env|sudo)\\s+(?:-[a-zA-Z]+\\s+|[\\w-]+(?:=[\\w/.-]*)?\\s+)*|nohup\\s+)*(${BIN_ALT})\\b`,
);
// Full paths: /usr/bin/ls, /bin/cat, /usr/local/bin/grep, /usr/sbin/…
const FULL_PATH = new RegExp(`/(?:usr/)?(?:bin|sbin)/(${BIN_ALT})\\b`);

// Git mutating subcommand alternation (without the leading `\bgit\s+(`)
// so FULL_PATH_GIT can compose it after `/usr/bin/git `.
const GIT_MUTATING_SUB =
  "push\\b" +
  "|stash\\b(?!\\s+push\\b(?:\\s+--\\s+\\S|\\s+--include-untracked\\b))" +
  "|reset\\s+--hard\\b" +
  "|clean\\s+-f?d\\b" +
  "|branch\\s+-[dD]\\b" +
  "|commit\\s+--amend\\b";

// `git status`/`git log`/`git diff` are read-only and stay allowed; mutating
// forms are blocked on evasion-form reaches. `git stash push -- <pathspec>`
// is allowed (pathspec-scoped, won't sweep other agents' in-flight work —
// same safe shape as the bashInterceptor rule).
const GIT_MUTATING = `\\bgit\\s+(${GIT_MUTATING_SUB})`;

// `command git push …` / `builtin git stash …`
const COMMAND_GIT = new RegExp(`\\bcommand\\s+${GIT_MUTATING}`);
const BUILTIN_GIT = new RegExp(`\\bbuiltin\\s+${GIT_MUTATING}`);
// `bash -c "git push …"` / `bash -c "cd /tmp && git push …"` — the inner
// command is matched as a single-quoted or double-quoted string (or an
// unquoted token), with the mutating subcommand required anywhere after
// the opening delimiter. Chained inner commands (`cd /tmp && git push …`)
// work because the `.*?` non-greedy match covers arbitrary inner content.
// `env`/`sudo` wrappers are accepted BEFORE the shell (`env bash -c …`)
// AND between `-c` and the inner command (`bash -c "sudo git push"`).
const SHELL_C_GIT = new RegExp(
  `(?:(?:sudo|env|nohup)\\s+(?:-[a-zA-Z]+\\s+|\\S+\\s+)*)*(?:ba|z|d)?sh\\s+-c\\s+(?:"[^"\\n]*"|'[^'\\n]*'|\\S+?).*?${GIT_MUTATING}`,
);
// `/usr/bin/git push …` / `/bin/git stash …`
const FULL_PATH_GIT = new RegExp(`/(?:usr/)?(?:bin|sbin)/git\\s+(${GIT_MUTATING_SUB})`);

// Binaries known to accept a shell-command string via `-c` / `--command` /
// `-e` flags and execute it through a shell. Using these wrappers as shell
// passthroughs is the same evasion shape as `bash -c "…"` — the wrapper
// binary replaces bash, so bashInterceptor never sees the inner command.
// The whitelist keeps the surface narrow: only binaries that genuinely
// execute shell payloads are listed, so general-purpose scripting hosts
// (`node -e`, `python -c`) stay out of scope and their string-literal
// contents don't false-positive against INTERCEPTED-token regexes.
const SHELL_PASSTHROUGH: Record<string, true> = {
  bash: true, sh: true, zsh: true, dash: true, busybox: true, ash: true, ksh: true, fish: true,
  env: true, sudo: true, nohup: true, nice: true, time: true, timeout: true, xargs: true,
  "lean-ctx": true, rtk: true, xd: true,
};
// Match `<wrapper> -c "<inner>"` / `--command "<inner>"` / `-e "<inner>"` /
// `--eval "<inner>"` where the wrapper is one of SHELL_PASSTHROUGH. Group 1

// is the wrapper binary, group 2 is the flag, group 3 is the inner payload
// (double-quoted). Single-quoted payloads (group 4) and unquoted tokens
// (group 5) are accepted for completeness — `bash -c ls` is valid syntax
// even if unusual. The match is anchored to a preceding space or string
// start so `-c` doesn't match the inside of `git -c protocol.version=2`.
const SHELL_STRING_FLAG = /(?:^|\s)([a-zA-Z_][\w.-]*)[\s,;&|]+(-{1,2}(?:command|eval|c|e))\s*(?:=\s*)?(?:"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|(\S+))/;
/**
 * Split a command string on UNQUOTED shell sequencing separators:
 * `&&` / `||` / `;` / `|`. Quoted regions (single/double quotes) are
 * treated atomically — they never split, and the segment text returned
 * preserves them verbatim. Newline (`\n`) is also a sequencing separator
 * in shells even though it's rare in tool calls.
 *
 * Why this exists: bashInterceptor patterns anchor on `^`, so a chained
 * prefix like `cd /tmp && git push …` hides the second segment. The bash
 * tool runs the whole string, so we must inspect each segment.
 */
type ParserState = { out: string[]; buf: string; q: "'" | '"' | null };

type StepVerdict = "cont" | "single" | "double" | "escape";

function step(state: ParserState, ch: string, next: string | undefined): StepVerdict {
  const { q } = state;
  // Inside a quoted region: emit character verbatim; closing quote ends it.
  if (q) {
    state.buf += ch;
    if (ch === q) state.q = null;
    return "cont";
  }
  // Opening quote: switch to single/double-quote mode.
  if (ch === "'" || ch === '"') {
    state.q = ch as "'" | '"';
    state.buf += ch;
    return "cont";
  }
  // Backslash escape: keep both the backslash and the escaped char in the
  // current segment's buffer (the shell treats them as one literal token).
  // Consume two chars (advance the loop one extra) but DO NOT emit a
  // segment boundary — `echo a\&b` is a single command, not two segments.
  if (ch === "\\" && next !== undefined) {
    state.buf += ch + next;
    return "escape";
  }
  // Sequencing separators: `&&`/`||`/`;`/`\n`/`|`/`&`. `&` (background)
  // schedules the next segment to run immediately — semantically equivalent
  // to `;` for harness-interception. Two-character separators are checked
  // first so `&` doesn't match the leading byte of `&&` (and similarly
  // `|`/`||`).
  if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
    return "double";
  }
  if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
    return "single";
  }
  state.buf += ch;
  return "cont";
}

export function splitCommandSegments(cmd: string): string[] {
  if (!cmd) return [];
  const state: ParserState = { out: [], buf: "", q: null };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === undefined) continue;
    const next = cmd[i + 1];
    const verdict = step(state, ch, next);
    if (verdict === "cont") continue;
    if (verdict === "escape") {
      // Backslash already consumed both chars into buf; skip the escaped char.
      i++;
      continue;
    }
    state.out.push(state.buf);
    state.buf = "";
    if (verdict === "double") i++;
  }
  if (state.buf.length > 0) state.out.push(state.buf);
  return state.out.map((s) => s.trim()).filter((s) => s.length > 0);
}
/**
 * Terminal-state-changing prefixes that do not themselves trigger harness
 * guards but SHOULD be skipped before matching the next segment. `cd` and
 * `pushd` change directory; `set ±o errexit` (and similar `set` shell-options)
 * and an explicit `true`/`false` are inert markers. We strip leading whitespace
 * plus the prefix, returning the remaining command string. Returns null when
 * no prefix matches — caller should test other shapes against the original.
 *
 *   cd <path>            — single argument; `cd -` returns to $OLDPWD
 *   pushd <path>         — `pushd`/`popd` for directory stack; we strip pushd
 *   set -e / set +e / set -o pipefail / set +o pipefail
 *   true / false / :     — no-op shell builtins (allowed as separator fillers)
 *   `( … )` / `{ …; }` subshell braces are SEPARATORS not prefixes — handled
 *     by splitCommandSegments instead.
 */
export function stripChainPrefix(seg: string): string {
  // Allow multiple repeats (cd a && cd b && git push); loop until stable.
  // Strategy: split the segment into sub-segments on chain separators
  // (`&&`/`||`/`;`/`\n`/`|`/`&` — all handled by `splitCommandSegments`)
  // via `splitCommandSegments`, drop leading sub-segments whose CORE is a
  // terminal-state-changing prefix (`cd <path>`, `pushd <path>`, `set
  // <opts>`, `:`, `true`, `false`), and rejoin with the original separator.
  // Empty leading segments are dropped, so `cd a && cd b && git push`
  // becomes `git push`. The single-`&` (background) separator is treated
  // the same way — `cd /a & git push` schedules the second segment to
  // run immediately, semantically equivalent to `cd /a; git push`.
  const parts = splitCommandSegments(seg);
  if (parts.length <= 1) {
    if (isChainOnlyNoop(parts[0] ?? "")) return "";
    return seg;
  }
  let changed = true;
  while (changed) {
    changed = false;
    if (parts.length === 0) break;
    const head = parts[0] ?? "";
    if (head === "" || isChainOnlyNoop(head)) {
      parts.shift();
      changed = true;
      continue;
    }
    const stripped = stripDirectoryPrefix(head);
    if (stripped !== head) {
      parts[0] = stripped;
      changed = true;
    }
  }
  return parts.join(" && ").trim();
}

const STRIP_DIR_PREFIXES = [
  /^cd(?:\s+-|\s+--)?\s+(?:"[^"]*"|'[^']*'|\S+)/i,
  /^pushd(?:\s+-|\s+--)?\s+(?:"[^"]*"|'[^']*'|\S+)/i,
];
function stripDirectoryPrefix(head: string): string {
  for (const re of STRIP_DIR_PREFIXES) {
    const m = re.exec(head);
    if (m) return head.slice(m[0].length).trim();
  }
  return head;
}
function isChainOnlyNoop(head: string): boolean {
  return /^\s*(?::|\btrue\b|\bfalse\b)\s*$/i.test(head) || /^\s*set\b/.test(head);
}
const GIT_GLOBAL_FLAG_WITH_ARG = /(?:^|\s)(?:-C|-c)\s+(?:"[^"]*"|'[^']*'|\S+)/g;
const GIT_GLOBAL_FLAG_EQ =
  /(?:^|\s)--[a-z][-a-z0-9]*=[^\s'"]*(?:"[^"]*"|'[^']*'|[^\s'"\\]*(?:\\.[^\s'"]*)*)/g;
const GIT_GLOBAL_FLAG_BARE =
  /(?:^|\s)(?:-P|--paginate|--no-pager|--bare|--no-replace-objects|--help|--version|-h)\b/g;

export function stripGitOptionPrefix(seg: string): string {
  return seg
    .replace(GIT_GLOBAL_FLAG_WITH_ARG, " ")
    .replace(GIT_GLOBAL_FLAG_EQ, " ")
    .replace(GIT_GLOBAL_FLAG_BARE, " ");
}

export const EVASION_REASON =
  "BLOCKED: `command`/`builtin`/`bash -c`/full-path form bypasses harness interception — " +
  "use the dedicated `read`/`grep`/`glob`/`edit` tools (or `mcp__lean_ctx_ctx_*`) instead. " +
  "Tool discovery via `which`/`command -v` stays allowed.";

export const GIT_MUTATING_REASON =
  "BLOCKED: git mutating subcommand (`push`/`stash`/`reset --hard`/`clean -fd`/`branch -D`/" +
  "`commit --amend`) reached via evasion form (chained-prefix `cd … && …`, `command`/" +
  "`builtin`/`bash -c`/full-path, or `git -C/-c/--git-dir=` global-option prefix) — the " +
  "bashInterceptor line-anchored regex misses this shape; the rule on `git push`/" +
  "`git stash` (see agent/config.yml bashInterceptor) still applies. Run `git status`/" +
  "`git log`/`git diff` directly for read-only inspection; for mutating operations, ask " +
  "the user per the rule.";

/**
 * Test a single segment for git mutating subcommands after normalizing
 * chain-prefix (`cd … && …`) and git global-option prefixes
 * (`git -C /repo push …`). When the normalization yields an empty string,
 * the segment was purely chain-prefix noise — fall through.
 */
const GIT_MUTATING_RE = new RegExp(GIT_MUTATING);

function gitMutatingForSegment(seg: string, inChain: boolean): string | undefined {
  if (!seg || seg.startsWith("#")) return undefined;
  const origHit =
    COMMAND_GIT.test(seg) ||
    BUILTIN_GIT.test(seg) ||
    SHELL_C_GIT.test(seg) ||
    FULL_PATH_GIT.test(seg);
  if (origHit) return GIT_MUTATING_REASON;
  const deChained = stripChainPrefix(seg);
  // `cd /repo && git push …` — second segment saw no chain prefix on itself,
  // but the WHOLE command had a separator so the segment is reached via an
  // evasion (chain prefix hides `git` from bashInterceptor's `^` anchor).
  if (inChain && deChained && GIT_MUTATING_RE.test(deChained)) {
    return GIT_MUTATING_REASON;
  }
  // Repeated `cd /a; cd /b; git push` — the chain prefix DID change the text.
  if (
    deChained &&
    deChained !== seg &&
    (COMMAND_GIT.test(deChained) ||
      BUILTIN_GIT.test(deChained) ||
      SHELL_C_GIT.test(deChained) ||
      FULL_PATH_GIT.test(deChained) ||
      (inChain && GIT_MUTATING_RE.test(deChained)))
  ) {
    return GIT_MUTATING_REASON;
  }
  // `git -C /repo push …` — global-option prefix breaks `\bgit\s+push` adjacency;
  // only flag when the prefix was actually stripped.
  const deGitOpt = stripGitOptionPrefix(deChained);
  if (
    deGitOpt &&
    deGitOpt !== deChained &&
    (GIT_MUTATING_RE.test(deGitOpt) || FULL_PATH_GIT.test(deGitOpt))
  ) {
    return GIT_MUTATING_REASON;
  }
  return undefined;
}

export function gitMutatingReason(cmd: string): string | undefined {
  if (!cmd || cmd.startsWith("#")) return undefined;
  const segments = splitCommandSegments(cmd);
  const inChain = segments.length > 1;
  // No separators present — single-command path; preserve the existing fast
  // path (avoids the segment-split cost in the common case) and the
  // single-segment semantic (raw `git push` is bashInterceptor's job, not
  // the evasion guard's — we only escalate on chain-prefix / global-option
  // disguises).
  if (!inChain) {
    const only = segments[0] ?? cmd;
    return gitMutatingForSegment(only, false);
  }
  for (const seg of segments) {
    const reason = gitMutatingForSegment(seg, true);
    if (reason) return reason;
  }
  return undefined;
}

/**
 * Non-git evasion paths — chained-prefix `cd /repo && <INTERCEPTED>` hiding
 * the intercepted binary from bashInterceptor's `^\s*<bin>\s+` anchor, plus
 * `command`/`builtin`/`bash -c`/full-path evasion wrappers on INTERCEPTED.
 *
 * Wrapper-prefix strip (`env` / `sudo` / `nohup`, with optional args) is
 * applied after `stripChainPrefix` so `cd /repo && env cat /etc/passwd`
 * reduces to `cat /etc/passwd` and trips `INTERCEPTED_TOKEN_RE` on the
 * second pass. Mirrors the inner-prefix logic in SHELL_C but applied at
 * the chain-prefix layer for the `cd /repo && wrapper <bin>` shape.
 */
// Short flags known to take a separate value token (consumed together with
// the value). Stays narrow: `-u`/`-g` (sudo user/group), `-E`/`-U` (env).
// Other short flags (`-i`) take no value and must not consume the next token.
const VALUE_TAKING_SHORT_FLAGS = new Set(["u", "g", "E", "U"]);


/**
 * Strip a leading `sudo`/`env`/`nohup` wrapper (and its flag/arg prefixes)
 * so the remainder starts with the binary the wrapper is invoking. Returns
 * the original segment unchanged when the wrapper does NOT precede an
 * INTERCEPTED binary — `env VAR=val /etc/passwd` is benign and should not be
 * flattened to `/etc/passwd`. Used after `stripChainPrefix` so
 * `cd /repo && env cat /etc/passwd` reduces to `cat /etc/passwd` and trips
 * `INTERCEPTED_TOKEN_RE` on the second pass.
 */
function stripWrapperPrefix(seg: string): string {
 const m = seg.match(/^\s*(sudo|env|nohup)\b\s+/);
 if (!m) return seg;
 const tail = seg.slice(m[0].length);
 const tokens: string[] = [];
 const re = /(\s+)|(\S+)/g;
 let tm: RegExpExecArray | null;
 while ((tm = re.exec(tail))) if (tm[2]) tokens.push(tm[2]);
 let i = 0;
 let sawIntercepted = false;
 while (i < tokens.length) {
 const tok = tokens[i] ?? "";
 if (INTERCEPTED.has(tok)) {
 sawIntercepted = true;
 break;
 }
 const sm = /^(-[a-zA-Z])$/.exec(tok);
 if (sm && VALUE_TAKING_SHORT_FLAGS.has((sm[1] ?? "").slice(1))) {
 const next = tokens[i + 1];
 if (next && !next.startsWith("-") && !INTERCEPTED.has(next)) {
 i += 2;
 continue;
 }
 }
 i++;
 }
 if (!sawIntercepted) return seg;
 let consumedLen = 0;
 for (let k = 0; k < i; k++) consumedLen += (tokens[k] ?? "").length + 1;
 return tail.slice(consumedLen).trimStart();
}

/**
 * Non-git evasion paths — chained-prefix `cd /repo && <INTERCEPTED>` hiding
 * the intercepted binary from bashInterceptor's `^\s*<bin>\s+` anchor, plus
 * `command`/`builtin`/`bash -c`/full-path evasion wrappers on INTERCEPTED.
 */
function nonGitEvasion(segments: string[]): string | undefined {
  const inChain = segments.length > 1;
  const isEvasion = (seg: string): boolean =>
    COMMAND_EXEC.test(seg) || BUILTIN_EXEC.test(seg) || SHELL_C.test(seg) || FULL_PATH.test(seg);
  const INTERCEPTED_TOKEN_RE = new RegExp(`^\\s*(${BIN_ALT})\\b`);
  if (inChain) {
    for (const seg of segments) {
      const deChained = stripChainPrefix(seg);
      // Wrapper-strip too: `cd /repo && env cat …` reduces to `cat …` only
      // after both chain- AND wrapper-prefix removal.
      const deWrapped = stripWrapperPrefix(deChained);
      if (deWrapped && INTERCEPTED_TOKEN_RE.test(deWrapped)) return EVASION_REASON;
    }
  }
  for (const seg of segments) {
    if (isEvasion(seg)) return EVASION_REASON;
    const deChained = stripChainPrefix(seg);
    if (deChained && deChained !== seg && isEvasion(deChained)) return EVASION_REASON;
  }
  return undefined;
}

/**
 * Walk the command string for `<wrapper> -c "<inner>"` / `--command "<inner>"`
 * / `-e "<inner>"` / `--eval "<inner>"` shapes where the wrapper is in
 * SHELL_PASSTHROUGH. For each match, recursively run `evasionReason` on the
 * inner payload. If the inner payload would itself be a violation (chain
 * prefix hiding an intercepted binary, git mutating subcommand, etc.) the
 * outer wrapper is also a violation — the wrapper binary replaces bash and
 * so bashInterceptor never sees the inner command.
 *
 * The captured inner payload is unescaped (`\\"` / `\\'` / `\\\\` → the
 * literal char) before recursion so the recursive call sees what bash
 * would actually execute. `bash -c "lean-ctx -c \\"cat\\""` regex-captures
 * `lean-ctx -c \\"cat\\"` (literal backslash-quote); without unescape the
 * bare-intercepted-token check sees `\\"cat\\"` and misses `cat`.
 *
 * Without this, `lean-ctx -c "cd /repo && tail -60 foo.log"` slips past
 * bashInterceptor (tail is chained behind a prefix, not line-anchored) and
 * past SHELL_C (wrapper is `lean-ctx`, not bash/sh/zsh/dash).
 */
function shellStringFlagReason(cmd: string): string | undefined {
  const INTERCEPTED_TOKEN_RE = new RegExp(`^\\s*(${BIN_ALT})\\b`);
  for (const match of cmd.matchAll(new RegExp(SHELL_STRING_FLAG, "g"))) {
    const wrapper = match[1];
    if (!wrapper || !(wrapper in SHELL_PASSTHROUGH)) continue;
    // Unescape `\\"` / `\\'` / `\\\\` to the literal char — these are the
    // shell-quote escapes that survive outer quoting. Other `\\x` forms
    // are left as-is because the shell treats them as literal backslash.
    const rawInner = (match[3] ?? match[4] ?? match[5] ?? "").replace(/\\(["'\\])/g, "$1");
    // Strip the outer quote pair when the captured inner keeps the
    // delimiters (regex captures the contents AND the quote chars).
    // `bash -c "env cat x"` captures `"env cat x"` (with quotes); after
    const inner = rawInner.replace(/^(['"])(.*)\1$/, "$2");
    if (!inner) continue;
    // Always recurse on the inner payload — the inner string is what the
    // shell will execute regardless of whether the flag is `-c`, `--command`,
    // or `-e`. SHELL_C only matches `-c` shape, so variants like
    // `bash --command "cat"` and `bash -e "tail -60"` won't trip the outer
    // regex; the recursive call on the inner is what catches them.
    const reason = evasionReason(inner);
    if (reason) return reason;
    // Bare-intercepted-token check: the inner may contain a top-level
    // invocation of an INTERCEPTED binary (e.g. `rtk -c "tail -60 foo"`).
    // bashInterceptor's `^\\s*<bin>` rule misses this because the OUTER
    // command starts with `rtk`, not the intercepted binary; the inner
    // payload is exactly what bashInterceptor would have caught if it
    // were the top-level command.
    for (const seg of splitCommandSegments(inner)) {
      if (INTERCEPTED_TOKEN_RE.test(seg)) return EVASION_REASON;
      if (GIT_MUTATING_RE.test(seg)) return GIT_MUTATING_REASON;
    }
  }
  return undefined;
}

export function evasionReason(cmd: string): string | undefined {
  if (!cmd || cmd.startsWith("#")) return undefined;
  const shellFlag = shellStringFlagReason(cmd);
  if (shellFlag) return shellFlag;
  const git = gitMutatingReason(cmd);
  if (git) return git;
  return nonGitEvasion(splitCommandSegments(cmd));
}
export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    const reason = evasionReason(command);
    if (!reason) return;
    return { block: true, reason };
  });
}
