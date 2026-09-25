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

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
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
// Read-only stash inspection (`list`/`show`) stays allowed on ALL reaches;
// `stash pop`/`apply`/`drop` mutate shared worktree state and stay blocked.
const GIT_MUTATING_SUB =
  "push\\b" +
  "|stash\\b(?!\\s+(?:push\\b(?:\\s+--\\s+\\S|\\s+--include-untracked\\b)|list\\b|show\\b))" +
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
  bash: true,
  sh: true,
  zsh: true,
  dash: true,
  busybox: true,
  ash: true,
  ksh: true,
  fish: true,
  env: true,
  sudo: true,
  nohup: true,
  nice: true,
  time: true,
  timeout: true,
  xargs: true,
  "lean-ctx": true,
  rtk: true,
  xd: true,
};
// Match `<wrapper> -c "<inner>"` / `--command "<inner>"` / `-e "<inner>"` /
// `--eval "<inner>"` where the wrapper is one of SHELL_PASSTHROUGH. Group 1

// is the wrapper binary, group 2 is the flag, group 3 is the inner payload
// (double-quoted). Single-quoted payloads (group 4) and unquoted tokens
// (group 5) are accepted for completeness — `bash -c ls` is valid syntax
// even if unusual. The match is anchored to a preceding space or string
// start so `-c` doesn't match the inside of `git -c protocol.version=2`.
const SHELL_STRING_FLAG =
  /(?:^|\s)([a-zA-Z_][\w.-]*)[\s,;&|]+(-{1,2}(?:command|eval|c|e))\s*(?:=\s*)?(?:"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|(\S+))/;
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
  "`command`/`builtin`/`bash -c`/full-path form bypasses harness interception — the " +
  "wrapper runs the binary behind bash's back, so the line-anchored bashInterceptor " +
  "never rewrites it. Tool discovery via `which`/`command -v` stays allowed.";

// A dedicated-tool binary reached through a chain separator (`cd`-prefix,
// `&&`/`||`/`;`/`|`/`&`/newline): bashInterceptor anchors every pattern on
// `^\s*`, so the chain hides the binary from the rewrite layer.
export const CHAIN_REASON =
  "chained-segment reach: a binary with a dedicated harness tool runs behind a chain " +
  "separator — the line-anchored bashInterceptor only rewrites command-initial " +
  "shapes, so the chain hides it from the rewrite layer.";

export const GIT_MUTATING_REASON =
  "git mutating subcommand (`push`/`stash`/`reset --hard`/`clean -fd`/`branch -D`/" +
  "`commit --amend`) reached via an evasion or chain form the line-anchored " +
  "bashInterceptor misses. Read-only inspection (`git status`/`git log`/`git diff`) " +
  "stays allowed; mutating operations need the user.";

/** Per-subcommand fix for git mutating blocks. */
const GIT_FIX: Record<string, string> = {
  push: "commit locally and present the hash; `git push` needs explicit user authorization (ask). `git push --dry-run` and `git push -h` are allowed (information only).",
  stash:
    "sanctioned stash shape: `git stash push -- <pathspec-you-own>` (optionally `--include-untracked`); otherwise commit the change.",
  "reset --hard":
    "irreversible history mutation — inspect with `git status`/`git log`/`git diff` and ask the user before destroying state.",
  "clean -fd":
    "irreversible history mutation — inspect with `git status`/`git log`/`git diff` and ask the user before destroying state.",
  "branch -D":
    "irreversible history mutation — inspect with `git status`/`git log`/`git diff` and ask the user before destroying state.",
  "commit --amend":
    "irreversible history mutation — inspect with `git status`/`git log`/`git diff` and ask the user before destroying state.",
};

/** Per-wrapper-form fix for evasion blocks. */
const WRAPPER_FIX: Record<string, string> = {
  command:
    "drop the `command` prefix so the binary is the command head, or use the dedicated tool.",
  builtin:
    "drop the `builtin` prefix so the binary is the command head, or use the dedicated tool.",
  "shell-c":
    "run the inner command directly as the bash command — no `sh -c`/`bash -c` wrapper — or use the dedicated tool.",
  "full-path":
    "invoke the binary by name, without the `/usr/bin/`-style prefix, or use the dedicated tool.",
};

/**
 * Dedicated-tool fix per intercepted binary — mirrors the agent/config.yml
 * bashInterceptor routing (read/grep/glob/edit).
 */
const TOOL_FIX: Record<string, string> = {
  cat: '`read` tool: {"path": "<file>"} — selectors: `:-N` last N lines, `N-M` range, `:raw`.',
  head: '`read` tool: {"path": "<file>:N-M"} (leading range).',
  tail: '`read` tool: {"path": "<file>:-N"} (last N lines).',
  less: '`read` tool: {"path": "<file>"}.',
  more: '`read` tool: {"path": "<file>"}.',
  ls: '`read` tool on the directory: {"path": "<dir>"} (or ctx_tree).',
  grep: '`grep` tool: {"pattern": "…", "path": "…"}; for command OUTPUT capture to an in-root `.tmp/` file first, or use the command\'s own filter (e.g. `git log --grep=`).',
  rg: '`grep` tool: {"pattern": "…", "path": "…"}.',
  ripgrep: '`grep` tool: {"pattern": "…", "path": "…"}.',
  ag: '`grep` tool: {"pattern": "…", "path": "…"}.',
  ack: '`grep` tool: {"pattern": "…", "path": "…"}.',
  find: '`glob` tool: {"pattern": "**/<name>"}; directory listings: `read` on the dir.',
  fd: '`glob` tool: {"pattern": "**/<name>"}.',
  locate: '`glob` tool: {"pattern": "**/<name>"}.',
  sed: "in-place edits (`-i`) go through the `edit` tool/ctx_patch; stream `sed` — rerun it as the command head.",
  awk: "in-place edits (`-i inplace`) go through the `edit` tool/ctx_patch; stream `awk` — rerun it as the command head.",
  sort: "harmless bare — rerun as the command head so the interceptor sees it.",
  uniq: "harmless bare — rerun as the command head so the interceptor sees it.",
  wc: "harmless bare — rerun as the command head so the interceptor sees it.",
  diff: "harmless bare — rerun as the command head so the interceptor sees it.",
};
const DEFAULT_TOOL_FIX =
  "use the dedicated harness tool for this binary (read/grep/glob/edit per agent/config.yml bashInterceptor).";

const WRITE_TARGET_FIX =
  "redirect into an in-root `.tmp/` scratch path; for existing out-of-root files use the native `edit` tool; installs go through the project installer.";

const INTERPRETER_FIX =
  "write the code to a re-executable script — native `write` into an in-root `./.tmp/` dir — then run it via bash: `python ./.tmp/x.py` or `bun ./.tmp/x.ts`.";

/** Collapse whitespace and bound the evidence span length. */
function truncSpan(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Append matched-span + fix evidence to a static reason base. */
function withEvidence(base: string, matched: string, seg: string, fix: string): string {
  return `${base}\nmatched: \`${truncSpan(matched)}\` in segment \`${truncSpan(seg)}\`\nfix: ${fix}`;
}

/** Full git-mutating block message for one matched subcommand. */
function gitReason(sub: string, seg: string): string {
  return withEvidence(
    GIT_MUTATING_REASON,
    `git ${sub}`,
    seg,
    GIT_FIX[sub] ?? "ask the user before mutating shared state.",
  );
}

/**
 * Test a single segment for git mutating subcommands after normalizing
 * chain-prefix (`cd … && …`) and git global-option prefixes
 * (`git -C /repo push …`). When the normalization yields an empty string,
 * the segment was purely chain-prefix noise — fall through.
 */
const GIT_MUTATING_RE = new RegExp(GIT_MUTATING);

function gitMutatingForSegment(seg: string, inChain: boolean): string | undefined {
  if (!seg || seg.startsWith("#")) return undefined;
  const subOf = (re: RegExp, text: string): string | undefined => re.exec(text)?.[1];
  const orig =
    subOf(COMMAND_GIT, seg) ??
    subOf(BUILTIN_GIT, seg) ??
    subOf(SHELL_C_GIT, seg) ??
    subOf(FULL_PATH_GIT, seg);
  if (orig) return gitReason(orig, seg);
  const deChained = stripChainPrefix(seg);
  // `cd /repo && git push …` — second segment saw no chain prefix on itself,
  // but the WHOLE command had a separator so the segment is reached via an
  // evasion (chain prefix hides `git` from bashInterceptor's `^` anchor).
  if (inChain && deChained) {
    const chainSub = GIT_MUTATING_RE.exec(deChained)?.[1];
    if (chainSub) return gitReason(chainSub, seg);
  }
  // Repeated `cd /a; cd /b; git push` — the chain prefix DID change the text.
  if (deChained && deChained !== seg) {
    const wrappedSub =
      subOf(COMMAND_GIT, deChained) ??
      subOf(BUILTIN_GIT, deChained) ??
      subOf(SHELL_C_GIT, deChained) ??
      subOf(FULL_PATH_GIT, deChained) ??
      (inChain ? GIT_MUTATING_RE.exec(deChained)?.[1] : undefined);
    if (wrappedSub) return gitReason(wrappedSub, seg);
  }
  // `git -C /repo push …` — global-option prefix breaks `\bgit\s+push` adjacency;
  // only flag when the prefix was actually stripped.
  const deGitOpt = stripGitOptionPrefix(deChained);
  if (deGitOpt && deGitOpt !== deChained) {
    const optSub = GIT_MUTATING_RE.exec(deGitOpt)?.[1] ?? FULL_PATH_GIT.exec(deGitOpt)?.[1];
    if (optSub) return gitReason(optSub, seg);
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
/** Tokenize whitespace-separated tokens (no shell parsing). */
function tokenize(tail: string): string[] {
  const tokens: string[] = [];
  const re = /(\s+)|(\S+)/g;
  let tm: RegExpExecArray | null = re.exec(tail);
  while (tm !== null) {
    if (tm[2]) tokens.push(tm[2]);
    tm = re.exec(tail);
  }
  return tokens;
}

/**
 * Walk `tokens` until an INTERCEPTED binary is found; track consumed
 * positions so the caller can slice the wrapper+flag prefix off the front.
 * Returns the token index where the intercepted binary lives (consumed
 * prefix is `tokens[0..i]`).
 */
function findInterceptedIndex(tokens: string[]): number {
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i] ?? "";
    if (INTERCEPTED.has(tok)) return i;
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
  return -1;
}

/** Sum the character widths of `tokens[0..count)` plus one separator each. */
function tokensCharWidth(tokens: string[], count: number): number {
  let n = 0;
  for (let k = 0; k < count; k++) n += (tokens[k] ?? "").length + 1;
  return n;
}

function stripWrapperPrefix(seg: string): string {
  const m = seg.match(/^\s*(sudo|env|nohup)\b\s+/);
  if (!m) return seg;
  const tail = seg.slice(m[0].length);
  const tokens = tokenize(tail);
  const i = findInterceptedIndex(tokens);
  if (i < 0) return seg;
  return tail.slice(tokensCharWidth(tokens, i)).trimStart();
}

/**
 * Non-git evasion paths — chained-prefix `cd /repo && <INTERCEPTED>` hiding
 * the intercepted binary from bashInterceptor's `^\s*<bin>\s+` anchor, plus
 * `command`/`builtin`/`bash -c`/full-path evasion wrappers on INTERCEPTED.
 */
/** Detect one of the four INTERCEPTED-binary wrappers in a segment. */
function wrapperHitOn(seg: string): { kind: string; bin: string } | undefined {
  const command = COMMAND_EXEC.exec(seg);
  if (command?.[1]) return { kind: "command", bin: command[1] };
  const builtin = BUILTIN_EXEC.exec(seg);
  if (builtin?.[1]) return { kind: "builtin", bin: builtin[1] };
  const shellC = SHELL_C.exec(seg);
  if (shellC?.[1]) return { kind: "shell-c", bin: shellC[1] };
  const fullPath = FULL_PATH.exec(seg);
  if (fullPath?.[1]) return { kind: "full-path", bin: fullPath[1] };
  return undefined;
}

/** Build a wrapper-form block reason (command/builtin/shell-c/full-path). */
function wrapperReasonFor(kind: string, bin: string, seg: string): string {
  return withEvidence(
    EVASION_REASON,
    bin,
    seg,
    `${WRAPPER_FIX[kind] ?? ""} ${TOOL_FIX[bin] ?? DEFAULT_TOOL_FIX}`.trim(),
  );
}

/** When `seg` chains to an INTERCEPTED binary, return CHAIN_REASON; else undefined. */
function chainEvasionReasonFor(seg: string): string | undefined {
  const deChained = stripChainPrefix(seg);
  // Wrapper-strip too: `cd /repo && env cat …` reduces to `cat …` only
  // after both chain- AND wrapper-prefix removal.
  const deWrapped = stripWrapperPrefix(deChained);
  if (!deWrapped) return undefined;
  const INTERCEPTED_TOKEN_RE = new RegExp(`^\\s*(${BIN_ALT})\\b`);
  const bin = INTERCEPTED_TOKEN_RE.exec(deWrapped)?.[1];
  if (!bin) return undefined;
  return withEvidence(CHAIN_REASON, bin, seg, TOOL_FIX[bin] ?? DEFAULT_TOOL_FIX);
}

/** When `seg` resolves to a wrapper-form evasion (raw or after stripChainPrefix), build the reason. */
function wrapperEvasionReasonFor(seg: string): string | undefined {
  const hit = wrapperHitOn(seg);
  if (hit) return wrapperReasonFor(hit.kind, hit.bin, seg);
  const deChained = stripChainPrefix(seg);
  if (!deChained || deChained === seg) return undefined;
  const chainedHit = wrapperHitOn(deChained);
  if (!chainedHit) return undefined;
  return wrapperReasonFor(chainedHit.kind, chainedHit.bin, seg);
}

function nonGitEvasion(segments: string[]): string | undefined {
  const inChain = segments.length > 1;
  if (inChain) {
    for (const seg of segments) {
      const chainReason = chainEvasionReasonFor(seg);
      if (chainReason) return chainReason;
    }
  }
  for (const seg of segments) {
    const wrapperReason = wrapperEvasionReasonFor(seg);
    if (wrapperReason) return wrapperReason;
  }
  return undefined;
}

/**
 * Unescape shell-quote escapes and strip the outer quote pair, if present.
 */
function extractInner(match: RegExpMatchArray): string {
  const rawInner = (match[3] ?? match[4] ?? match[5] ?? "").replace(/\\(["'\\])/g, "$1");
  return rawInner.replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * Check the un-quoted inner payload of a `<wrapper> -c "…"` invocation for
 * either an INTERCEPTED binary or a git mutating subcommand — both are
 * violations that the outer wrapper would have hidden from the line-anchored
 * bashInterceptor. Returns the block reason, or undefined when benign.
 */
function checkInnerPayload(inner: string): string | undefined {
  const INTERCEPTED_TOKEN_RE = new RegExp(`^\\s*(${BIN_ALT})\\b`);
  for (const seg of splitCommandSegments(inner)) {
    const bin = INTERCEPTED_TOKEN_RE.exec(seg)?.[1];
    if (bin) {
      return withEvidence(EVASION_REASON, bin, seg, TOOL_FIX[bin] ?? DEFAULT_TOOL_FIX);
    }
    const sub = GIT_MUTATING_RE.exec(seg)?.[1];
    if (sub) return gitReason(sub, seg);
  }
  return undefined;
}

/** Is `match[1]` a recognized shell-passthrough wrapper (bash/rtk/xd/…)? */
function isPassthroughWrapper(match: RegExpMatchArray): boolean {
  const wrapper = match[1];
  return !!wrapper && wrapper in SHELL_PASSTHROUGH;
}

/** Recurse into the inner payload of one shell-string-flag match. */
function reasonForShellStringMatch(match: RegExpMatchArray): string | undefined {
  const inner = extractInner(match);
  if (!inner) return undefined;
  return evasionReason(inner) ?? checkInnerPayload(inner);
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
  for (const match of cmd.matchAll(new RegExp(SHELL_STRING_FLAG, "g"))) {
    if (!isPassthroughWrapper(match)) continue;
    const reason = reasonForShellStringMatch(match);
    if (reason) return reason;
  }
  return undefined;
}

// ---- out-of-root write-target guard ----------------------------------------
//
// Policy: agents must not write to system folders. The structured `write`
// tool is already gated to in-root `.tmp/` scratch (lean-ctx-native-reroute);
// this closes the same shape arriving through bash: unquoted redirection
// targets (`>`, `>>`, `2>`, `&>`, …) and `tee` file arguments that resolve
// OUTSIDE the project root. `/dev/null`-family sinks and fd dups (`2>&1`)
// are exempt; in-root targets (including `.tmp/` scratch) stay allowed, so
// test pipelines and the installer flow are unaffected. Static-analysis
// limits apply: targets hidden in `$(...)`/process substitution are not
// resolved.

export const WRITE_TARGET_REASON =
  "bash writes outside the project root are blocked — scratch files belong in an in-root `.tmp/` dir; " +
  "for existing out-of-root files use the native `edit` tool, for installs the project installer.";

const DEV_SINK_RE = /^\/dev\/(?:null|stdout|stderr|stdin|fd\/\d+)$/;

function outsideRoot(abs: string): boolean {
  const rel = relative(process.cwd(), abs);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

function isBlockedWriteTarget(raw: string): boolean {
  const target = raw.startsWith("~") ? resolve(homedir(), raw.slice(1)) : resolve(raw);
  if (DEV_SINK_RE.test(target)) return false;
  return outsideRoot(target);
}

/** Quote-aware word split of a segment (quotes stripped, escapes resolved). */
function words(seg: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i] ?? "";
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < seg.length) {
      cur += seg[i + 1] ?? "";
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Step `i` past a quoted region (single/double quotes) starting at `seg[i]`. */
function skipQuotedRegion(seg: string, i: number): number {
  const q = seg[i];
  if (q !== "'" && q !== '"') return i;
  let k = i + 1;
  while (k < seg.length && seg[k] !== q) k++;
  return k + 1;
}

/** Read one shell word starting at `seg[j]`; returns `[word, newIndex]`. */
function readRedirectWord(seg: string, j: number): [string, number] {
  let word = "";
  let q: string | null = null;
  let k = j;
  while (k < seg.length) {
    const c = seg[k] ?? "";
    if (q) {
      if (c === q) q = null;
      else word += c;
      k++;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      k++;
      continue;
    }
    if (/\s/.test(c) || ";|&<>".includes(c)) break;
    word += c;
    k++;
  }
  return [word, k];
}

/**
 * From index `i` (already on `>`), parse the redirection op (`>>`/`>`/`&>`/
 * `2>&-`/`>&1`) and the following target word (if any). Returns
 * `[target, newIndex]` — `target` is empty when the redirect is an fd dup
 * or has no word to read.
 */
function parseOneRedirect(seg: string, i: number): [string, number] {
  let j = i + 1;
  if (seg[j] === ">") j++;
  if (seg[j] === "&") {
    const after = seg[j + 1] ?? "";
    if (/\d/.test(after) || after === "-") {
      return ["", j + 2]; // fd dup — no filesystem target
    }
    j++; // `&>file` — both streams into a file
  }
  while (j < seg.length && /\s/.test(seg[j] ?? "")) j++;
  const [word, k] = readRedirectWord(seg, j);
  return [word, k];
}

/**
 * Unquoted redirection write targets in one command segment:
 * `>f` `>>f` `2>f` `&>f` `1>>f`. Quoted `>` chars never match; fd dups
 * (`>&1`, `2>&-`) are skipped — they never touch the filesystem.
 */
function redirectTargets(seg: string): string[] {
  const targets: string[] = [];
  let i = 0;
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === "'" || ch === '"') {
      i = skipQuotedRegion(seg, i);
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== ">") {
      i++;
      continue;
    }
    const [word, next] = parseOneRedirect(seg, i);
    if (word) targets.push(word);
    i = Math.max(next, i + 1);
  }
  return targets;
}

/**
 * Block bash file writes landing outside the project root: redirection
 * targets and `tee` file arguments. Complements the `write`-tool gate —
 * without this, `echo x > ~/file` smuggles the same write past it.
 */
/** Scan one segment for any redirection write target landing outside the root. */
function redirectWriteReasonFor(seg: string): string | undefined {
  for (const target of redirectTargets(seg)) {
    if (isBlockedWriteTarget(target)) {
      return withEvidence(WRITE_TARGET_REASON, target, seg, WRITE_TARGET_FIX);
    }
  }
  return undefined;
}

/** Scan one segment for any `tee <file>` argument landing outside the root. */
function teeWriteReasonFor(seg: string): string | undefined {
  const tokens = words(seg);
  const teeIdx = tokens.findIndex((t) => t === "tee" || t.endsWith("/tee"));
  if (teeIdx < 0) return undefined;
  for (const tok of tokens.slice(teeIdx + 1)) {
    if (tok.startsWith("-")) continue;
    if (isBlockedWriteTarget(tok)) {
      return withEvidence(WRITE_TARGET_REASON, tok, seg, WRITE_TARGET_FIX);
    }
  }
  return undefined;
}

/**
 * Block bash file writes landing outside the project root: redirection
 * targets and `tee` file arguments. Complements the `write`-tool gate —
 * without this, `echo x > ~/file` smuggles the same write past it.
 */
export function bashWriteReason(cmd: string): string | undefined {
  for (const seg of splitCommandSegments(cmd)) {
    const redirect = redirectWriteReasonFor(seg);
    if (redirect) return redirect;
    const tee = teeWriteReasonFor(seg);
    if (tee) return tee;
  }
  return undefined;
}

// ---- interpreter inline-code guard -----------------------------------------
//
// eval.py/eval.js are disabled in agent/config.yml — computation must go
// through re-executable `.tmp/` scripts executed via bash. Inline interpreter
// code (`python -c`, `node -e`, `perl -pe`, `deno eval`, heredoc-to-stdin, or
// a bare interpreter reading a pipe) smuggles the same one-off computation
// past that policy. File-based runs (`python .tmp/x.py`, `node server.js`,
// `bun run dev`, `python -m venv .venv`) stay allowed. Static-analysis limits
// apply: code assembled via `$(...)` before it reaches the interpreter, REPL
// flag forms (`node -i`), and value-flag gaps are not inspected.

export const INTERPRETER_INLINE_REASON =
  "inline interpreter code (`-c`/`-e`/`--eval`/heredoc-to-stdin) bypasses the disabled `eval` tooling — " +
  "write a re-executable script under an in-root `.tmp/` dir and run it " +
  "(`python .tmp/x.py`, `bun .tmp/x.ts`)";

/** Interpreters whose inline-code / stdin modes are gated by the eval policy. */
const INTERPRETERS = new Set([
  "python",
  "python3",
  "node",
  "bun",
  "deno",
  "tsx",
  "ts-node",
  "perl",
  "ruby",
]);

/** Wrappers skipped before the interpreter token; `timeout` consumes a duration. */
const INTERP_WRAPPERS = new Set(["sudo", "env", "nohup", "nice", "time", "timeout"]);

/** Short flags whose NEXT token is a value, not the program operand. */
const INTERP_VALUE_FLAGS = new Set(["-m", "-W", "-X", "--input-type"]);

/**
 * Short-flag clusters that carry inline code. `-c`/`-e` plus perl/ruby
 * combined forms (`-pe`, `-ne`); node/bun hosts add `-p`/`--print`, which
 * evaluate an expression (perl's `-p` is a loop flag, not code — excluded).
 */
function inlineFlagsFor(head: string): (token: string) => boolean {
  const jsHost = head === "node" || head === "bun" || head === "tsx" || head === "ts-node";
  return (token) =>
    token === "--eval" ||
    token === "--command" ||
    token === "--exec" ||
    (jsHost && (token === "-p" || token === "--print")) ||
    /^-[a-zA-Z]*[ce]$/.test(token);
}

/**
 * One segment is an interpreter reading inline code: flag-based (`-c`/`-e`/
 * `--eval` before the program operand), heredoc-to-stdin (`interp … <<`),
 * stdin dash (`interp -`), or a bare interpreter (stdin/REPL mode, so a
 * piped `echo x | python` is caught — the segment split keeps pipe stages).
 * deno's `eval` is a subcommand, not a flag.
 */
function interpreterInlineForSegment(seg: string): boolean {
  const tokens = words(seg);
  let i = 0;
  while (i < tokens.length && tokens[i] !== undefined && INTERP_WRAPPERS.has(tokens[i] as string)) {
    i += 1;
    if (tokens[i - 1] === "timeout") i += 1; // consume the duration value
  }
  if (i >= tokens.length) return false;
  const head = tokens[i];
  if (head === undefined || !INTERPRETERS.has(head)) return false;
  if (head === "deno" && tokens[i + 1] === "eval") return true;
  const inlineFlag = inlineFlagsFor(head);
  let valueNext = false;
  for (const token of tokens.slice(i + 1)) {
    if (valueNext) {
      valueNext = false;
      continue;
    }
    if (token === "--") return false;
    if (inlineFlag(token)) return true;
    if (token === "-" || token.startsWith("<")) return true;
    if (!token.startsWith("-")) return false; // script/module operand — file-based run
    valueNext = INTERP_VALUE_FLAGS.has(token);
  }
  return tokens.length === i + 1; // bare interpreter → stdin/REPL mode
}

/**
 * eval-policy guard: no inline interpreter code anywhere in the command —
 * chained-prefix segments (`cd x && python -c …`) included via
 * splitCommandSegments, `bash -c "python -c …"` inners via the recursive
 * evasionReason evaluation in shellStringFlagReason.
 */
export function interpreterInlineReason(cmd: string): string | undefined {
  if (!cmd || cmd.startsWith("#")) return undefined;
  for (const seg of splitCommandSegments(cmd)) {
    if (interpreterInlineForSegment(seg)) {
      return withEvidence(INTERPRETER_INLINE_REASON, "inline-code flag", seg, INTERPRETER_FIX);
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
  const write = bashWriteReason(cmd);
  if (write) return write;
  const inline = interpreterInlineReason(cmd);
  if (inline) return inline;
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
