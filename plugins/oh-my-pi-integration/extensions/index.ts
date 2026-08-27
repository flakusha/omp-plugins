/**
 * Oh My Pi integration plugin — engram + rtk + lean-ctx.
 *
 * Scope: `~/.omp` only. This extension:
 *  1. Rewrites simple bash tool commands through `rtk` (output-trimming) or
 *     `lean-ctx -c` (compression) so agent tool output costs less context.
 *  2. Auto-saves concise memories to engram on mutations and at turn/session
 *     end.
 *
 * Opt out entirely with env `PI_INTEGRATION_DISABLE=1`.
 *
 * 3. Turn-start retrieval: when `PI_INTEGRATION_RETRIEVE=1`, at the start of
 *    a turn the plugin searches engram for prior recorded memories for this
 *    project and injects a bounded context block into the agent loop, so the
 *    agent can reuse an already-recorded solution instead of re-deriving it.
 *    Retrieval is best-effort and bounded (timeout + length cap) — on any
 *    failure or timeout the turn proceeds normally with no injection. Set
 *    `PI_RETRIEVE_EVERY_TURN=1` to re-retrieve on every turn (default: once
 *    per session, where cross-session reuse matters most).
 *
 * Safety model: rewrites ONLY single, simple commands (no pipes/separators/
 * quotes/heredocs). Anything ambiguous passes through untouched. PTY and
 * async (background) tool calls are never rewritten.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { GIT_DESTRUCTIVE_NOTICE, isDestructiveGitCommand } from "./guards/git-destructive-guard";
import { GPG_BLOCK_REASON, gpgSignHardStop, isGpgTamperCommand } from "./guards/gpg-guard";
import { isSshTamperCommand, SSH_BLOCK_REASON, sshSockHardStop } from "./guards/ssh-guard";
import { formatLintNote, lintablePath } from "./util/lint-feedback";

const DISABLE = () => typeof process !== "undefined" && process.env?.PI_INTEGRATION_DISABLE === "1";

/**
 * Read-only rtk subcommands whose filtering semantics are known-safe to route
 * through the `rtk` binary (output trimming that does not drop data the agent
 * needs). This curated set is the AUTHORITY for what we will ever route via
 * `rtk`; the installed rtk binary's actual subcommand list is discovered at
 * runtime (below) so routing stays in sync without emitting `rtk <missing>`.
 */
const RTK_SAFE_SUBCOMMANDS: Record<string, true> = {
  read: true,
  ls: true,
  tree: true,
  git: true,
  find: true,
  grep: true,
  rg: true,
  wc: true,
  diff: true,
  log: true,
  env: true,
  json: true,
  summary: true,
  deps: true,
  docker: true,
  kubectl: true,
  test: true,
  psql: true,
};

/**
 * Parse the subcommand names from `rtk --help` output. rtk prints a Commands
 * block of `  <name>  <description>` lines; flags (`  -h, --help`) and other
 * indented option lines do not start with a lowercase letter and are skipped.
 */
export function parseRtkSubcommands(helpText: string): Set<string> {
  const names = new Set<string>();
  for (const line of helpText.split("\n")) {
    const m = /^ {2}([a-z][a-z0-9-]*)[\t ]{2,}/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

/**
 * Pure routing decision: should `cmd`'s binary be rewritten through `rtk`?
 * - Only binaries in the curated SAFE set are ever routed.
 * - If the installed rtk was not discoverable, we never emit `rtk <missing>`
 *   (the generic lean-ctx branch compresses instead).
 * - If rtk is present but its subcommand list could not be enumerated, fall
 *   back to trust the curated SAFE set.
 * - Otherwise route only when the installed rtk actually exposes `bin`.
 */
export function routeRtk(bin: string, discovered: Set<string>, rtkAvailable: boolean): boolean {
  if (!RTK_SAFE_SUBCOMMANDS[bin]) return false;
  if (!rtkAvailable) return false;
  if (discovered.size === 0) return true; // enumerable-rtk unavailable → trust curated set
  return discovered.has(bin);
}

type RtkInfo = { available: boolean; subcommands: Set<string> };

/** Lazily discover the installed rtk once per process (cheap `--help`). */
let _rtkInfo: RtkInfo | null = null;
function rtkInfo(): RtkInfo {
  if (_rtkInfo) return _rtkInfo;
  _rtkInfo = loadRtkInfo();
  return _rtkInfo;
}

function loadRtkInfo(): RtkInfo {
  try {
    const res = spawnSync("rtk", ["--help"], { encoding: "utf8", timeout: 5000 });
    if (res.error || res.status !== 0 || !res.stdout) {
      return { available: false, subcommands: new Set() };
    }
    return { available: true, subcommands: parseRtkSubcommands(res.stdout) };
  } catch {
    return { available: false, subcommands: new Set() };
  }
}

/**
 * Shell constructs that break naive command rewriting: separators, pipelines,
 * redirects, command substitution, grouping. If any appear, we skip the rewrite.
 */
const SHELL_CONTROL = /[|;&<>`$(){}\\\n]/;

/** A simple command is a single command word plus plain args. */
export function isSimpleCommand(cmd: string): boolean {
  if (!cmd || cmd.length === 0) return false;
  if (cmd.trim() !== cmd) return false; // no leading/trailing whitespace groups
  if (SHELL_CONTROL.test(cmd)) return false; // no shell metachars / separators
  if (/^(sudo|env|nohup|time|nice)\s+/.test(cmd)) return false; // wrappers change argv0
  return true;
}

/** First whitespace-delimited token (the binary name). */
function firstToken(cmd: string): string {
  const m = cmd.match(/^([^\s]+)/);
  return m?.[1] ?? "";
}

/**
 * Native-binary → rtk-subcommand bridge. Handles the read-family
 * (`cat`/`head`/`tail`/`less`/`more`), which `routeRtk` does NOT cover (rtk
 * proxies them through `rtk read`, not `rtk cat`). Returns the rewritten
 * command string, or `undefined` when no safe mapping exists.
 *
 * Argument translation rules (intentionally narrow; anything ambiguous returns
 * undefined so the upstream `routeRtk` / `lean-ctx -c` paths handle it):
 *   cat [flags] <files...>  → rtk read [flags] <files...>     (cat -n / -E / -A kept when rtk read supports them; -A / -E rejected)
 *   head [-n N | -N] [file] → rtk read [--max-lines N] [file]
 *   tail [-n N | -N] [file] → rtk read [--tail-lines N] [file]
 *   less [-N] <file>        → rtk read [-N] <file>
 *   more <file>             → rtk read <file>
 *
 * Rejected (returns undefined → upstream fallback):
 *   - cat -A / -E / -T / -v (rtk read does not expose show-special-chars)
 *   - head -c N (byte count, not line count)
 *   - tail -c N (byte count)
 *   - head/tail --help, --version (info commands; not file reads)
 *   - any args containing '=' (env-var-style, ambiguous)
 *
 * --------------------------------------------------------------------------
 * ARCHITECTURAL CEILING: this function rewrites to another `bash` invocation.
 * It does NOT route to MCP. Hooks cannot reshape `toolName` (`bash` stays
 * `bash`), and `ExtensionContext` does not expose MCP client APIs to
 * extensions — so the dispatch layer can compress via rtk but cannot route
 * a `bash "cat file"` call to `mcp__lean_ctx_ctx_read`. The two ways to get
 * MCP routing for read-family commands are:
 *   1. Prompt-time: agent calls the built-in `read` tool directly (see rule
 *      `bash-read-family-prefer-read-tool`), which then triggers
 *      `lean-ctx-native-reroute` → `xd://mcp__lean_ctx_ctx_read`.
 *   2. Upstream: omp exposes MCP client to extensions so this function can
 *      dispatch directly. Tracked as an upstream issue.
 * Until then, this is the maximum compression achievable at the hook layer.
 * --------------------------------------------------------------------------
/** Flags rtk read does NOT expose on `cat`. */
const CAT_UNSUPPORTED = new Set([
  "-A",
  "-B",
  "-E",
  "-T",
  "-v",
  "--show-all",
  "--show-ends",
  "--show-tabs",
  "--show-nonprinting",
]);

/** `cat [flags] <files...>` -> `rtk read [flags] <files...>`. */
function handleCat(args: string[]): string | undefined {
  for (const a of args) {
    const isSafeFlag = a === "-n" || a === "--" || a === "-";
    if (a.startsWith("-") && !isSafeFlag && CAT_UNSUPPORTED.has(a)) return undefined;
  }
  return ["rtk", "read", ...args.filter((a) => a !== "-n")].join(" ");
}

/** `less`/`more` -> `rtk read`; `-N` (less line numbers) maps to `-n`. */
function handleLessMore(args: string[]): string {
  return ["rtk", "read", ...args.map((a) => (a === "-N" ? "-n" : a))].join(" ");
}

type HeadTailAction =
  | { kind: "count"; count: string }
  | { kind: "reject" }
  | { kind: "passthrough" };

/** Classify one head/tail arg into an action. Pure, no side effects. */
function classifyHeadTailArg(a: string, fileSeen: boolean): HeadTailAction {
  if (a === "-c" || a === "--bytes") return { kind: "reject" };
  if (a === "--help" || a === "--version" || a === "-h" || a === "-V") return { kind: "reject" };
  if (a === "-n" || a === "--lines") return { kind: "count", count: "PENDING" };
  const m = /^[-+]?(\d+)$/.exec(a);
  if (m?.[1] && !fileSeen) return { kind: "count", count: m[1] };
  if (a.startsWith("-")) return { kind: "reject" };
  return { kind: "passthrough" };
}

/** Consume a `-n N` / `--lines N` pair; returns the validated count or undefined. */
function readCountArg(args: string[], i: number): { count: string; nextI: number } | undefined {
  const n = args[i + 1];
  if (!n || !/^\d+$/.test(n)) return undefined;
  return { count: n, nextI: i + 1 };
}

/** `head [-n N | -N] [file]` -> `rtk read [--max-lines N] [file]`. */
function handleHeadTail(bin: "head" | "tail", args: string[]): string | undefined {
  const flag = bin === "head" ? "--max-lines" : "--tail-lines";
  const out: string[] = ["rtk", "read"];
  let count: string | undefined;
  let fileSeen = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    const action = classifyHeadTailArg(a, fileSeen);
    if (action.kind === "reject") return undefined;
    if (action.kind === "passthrough") {
      fileSeen = true;
      out.push(a);
      continue;
    }
    // action.kind === "count"
    if (action.count !== "PENDING") {
      count = action.count;
      continue;
    }
    const pair = readCountArg(args, i);
    if (!pair) return undefined;
    count = pair.count;
    i = pair.nextI;
  }
  if (count !== undefined) out.splice(2, 0, flag, count);
  return out.join(" ");
}

export function nativeToRtk(cmd: string): string | undefined {
  // isSimpleCommand above guarantees whitespace-separated plain args.
  const [bin, ...args] = cmd.split(/\s+/);
  if (bin === "cat") return handleCat(args);
  if (bin === "less" || bin === "more") return handleLessMore(args);
  if (bin === "head" || bin === "tail") return handleHeadTail(bin, args);
  return undefined;
}

/**
 * Decide the rewritten command, or return the original when nothing applies.
 * Binary availability is checked for lean-ctx (a compression wrapper) so we
 * never block or alter commands on machines without it. `rtk` is only applied
 * when we know its subcommand exists in the rtk surface.
 */
export function rewriteCommand(
  cmd: string,
  pty: boolean | undefined,
  isAsync: boolean | undefined,
): string {
  if (pty || isAsync) return cmd; // never touch interactive / background
  if (!isSimpleCommand(cmd)) return cmd;

  // 0) Native-binary → rtk-subcommand bridge (cat/head/tail/less/more → rtk read).
  //    Runs before routeRtk because those binaries are NOT in RTK_SAFE_SUBCOMMANDS
  //    (the safe set keys on rtk subcommands, not native binaries). This path
  //    picks them up directly without falling through to `lean-ctx -c "cat …"`.
  const bridged = nativeToRtk(cmd);
  if (bridged) return bridged;

  const bin = firstToken(cmd);

  // 1) rtk output-trimming: route through the installed rtk binary.
  //    `routeRtk` gates on the curated SAFE set AND the discovered subcommand
  //    list, so we never emit `rtk <missing>` on a machine without the binary
  //    (falls through to lean-ctx, which still compresses).
  const { available, subcommands } = rtkInfo();
  if (routeRtk(bin, subcommands, available)) {
    return `rtk ${cmd}`;
  }

  // 2) lean-ctx compression for any other simple command (git, npm, etc.).
  //    Only when lean-ctx is present; rtk lacks a generic compressed form.
  if (leanCtxAvailable()) {
    return `lean-ctx -c ${JSON.stringify(cmd)}`;
  }

  return cmd;
}

/** Presence cache: lean-ctx is checked once per process via PATH. */
let _leanCtx: boolean | null = null;
function leanCtxAvailable(): boolean {
  if (_leanCtx !== null) return _leanCtx;
  const pathEnv = (process.env as { PATH?: string }).PATH ?? "";
  _leanCtx = pathEnv.split(":").some((dir) => dir && existsSync(`${dir}/lean-ctx`));
  return _leanCtx;
}

/** Extract a short human note from a built-in tool result for the memory buffer. */
function toolNote(event: {
  toolName: string;
  isError: boolean;
  input: Record<string, unknown>;
}): string | undefined {
  if (event.isError) return undefined;
  if (event.toolName === "edit") {
    const path = String(event.input.path ?? event.input.file ?? "");
    return path ? `edited ${path}` : "edited a file";
  }
  if (event.toolName === "write") {
    const path = String(event.input.path ?? "");
    return path ? `wrote ${path}` : "wrote a file";
  }
  return undefined;
}
export default function integrationPlugin(pi: ExtensionAPI): void {
  if (DISABLE()) return;

  // Per-session buffer of notable mutations for this turn.
  const buffer: string[] = [];

  const projectFor = (cwd: string | undefined): string => {
    if (!cwd) return "omp";
    return cwd.split("/").filter(Boolean).pop() || "omp";
  };

  /** Push a memory to engram (best-effort, fire-and-forget with timeout). */
  function saveMemory(title: string, body: string, type: string, cwd: string | undefined) {
    const proj = projectFor(cwd);
    try {
      pi.exec("engram", ["save", title, body, "--type", type, "--project", proj], {
        timeout: 10_000,
      }).catch(() => {});
    } catch {
      /* engram save must never break the agent loop */
    }
  }

  // ---- 1) bash tool-call rewrite (rtk / lean-ctx) ----
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const { command, pty, async: isAsync } = event.input;
    if (!command || command.startsWith("#")) return;

    const rewritten = rewriteCommand(command, pty, isAsync);
    if (rewritten === command) return;

    return { input: { ...event.input, command: rewritten } };
  });

  // ---- 4) GPG signing hard-stop guard ----
  // Agents habitually try to "discover gpg config" / restart gpg-agent after a
  // signing failure instead of stopping. A locked secret key only a HUMAN can
  // unlock, so: (a) substitute an imperative hard-stop directive for the raw
  // signing error the model would otherwise read, and (b) block gpg-agent
  // lifecycle / passphrase-bypass commands outright.
  let gpgNotified = false;
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const { command } = event.input;
    if (!command || command.startsWith("#")) return;
    if (!isGpgTamperCommand(command)) return;
    return { block: true, reason: GPG_BLOCK_REASON };
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "bash" || !event.isError) return;
    const command = String(event.input?.command ?? "");
    const output = event.content
      .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text ?? "") : ""))
      .join("\n");
    const directive = gpgSignHardStop(command, output);
    if (!directive) return;
    if (!gpgNotified) {
      gpgNotified = true;
      ctx.ui.notify?.(
        "GPG signing failed — secret key locked. Unlock it (pinentry/smartcard); agent has stopped.",
        "error",
      );
    }
    return { content: [{ type: "text", text: directive }], isError: true };
  });

  // ---- 5) SSH agent socket hard-stop guard ----
  // Agents habitually try to "fix" an ssh-agent socket failure by killing
  // ssh-agent, removing the socket, or starting a new agent — which silently
  // switches to a socket whose keys aren't loaded. A missing/stale agent
  // socket needs a HUMAN to restore. (a) substitute a hard-stop directive for
  // the raw SSH error, and (b) block ssh-agent socket/process tampering.
  let sshNotified = false;
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const { command } = event.input;
    if (!command || command.startsWith("#")) return;
    if (!isSshTamperCommand(command)) return;
    return { block: true, reason: SSH_BLOCK_REASON };
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "bash" || !event.isError) return;
    const command = String(event.input?.command ?? "");
    const output = event.content
      .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text ?? "") : ""))
      .join("\n");
    const directive = sshSockHardStop(command, output);
    if (!directive) return;
    if (!sshNotified) {
      sshNotified = true;
      ctx.ui.notify?.(
        "SSH agent/socket failure — ssh-agent missing or stale. Restore it; agent has stopped.",
        "error",
      );
    }
    return { content: [{ type: "text", text: directive }], isError: true };
  });

  // ---- 6) destructive-git soft guard ----
  // Agents habitually stash / hard-reset / force-checkout uncommitted work to
  // "clear the way". This guard does NOT block (legitimate destructive git
  // exists) — it surfaces the loss risk to the user every time a destructive
  // git command succeeds, so the agent stops and verifies intent.
  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "bash" || event.isError) return;
    const command = String(event.input?.command ?? "");
    if (!isDestructiveGitCommand(command)) return;
    ctx.ui.notify?.(GIT_DESTRUCTIVE_NOTICE, "warning");
  });

  // ---- 7) post-edit lint feedback (Claude Code PostToolUse pattern) ----
  // Shift-left: after a successful edit/write of a TS file, run biome on that
  // file and surface diagnostics in the tool result so the agent fixes them
  // immediately instead of at the next verify gate. Best-effort: no biome on
  // PATH or any failure → silent; bounded per turn to avoid noise.
  const LINT_TIMEOUT_MS = 15_000;
  const LINT_MAX_PER_TURN = 4;
  let lintsThisTurn = 0;

  // Per-repo installs (node_modules/.bin) come first — that is where the
  // project's pinned biome lives; PATH is the fallback.
  let _biomeResolved: string | null | undefined; // undefined = not probed yet
  function resolveBiome(cwd: string | undefined): string | null {
    if (_biomeResolved !== undefined) return _biomeResolved;
    const candidates: string[] = [];
    if (cwd) candidates.push(`${cwd}/node_modules/.bin/biome`);
    const pathEnv = (process.env as { PATH?: string }).PATH ?? "";
    for (const dir of pathEnv.split(":")) {
      if (dir) candidates.push(`${dir}/biome`);
    }
    _biomeResolved = candidates.find((p) => existsSync(p)) ?? null;
    return _biomeResolved;
  }

  pi.on("turn_start", () => {
    lintsThisTurn = 0;
  });

  /** Early-exit guard chain: returns the file to lint, or undefined to skip. */
  function lintTarget(event: ToolResultEvent, cwd: string | undefined): string | undefined {
    if (event.isError) return undefined;
    if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
    if (lintsThisTurn >= LINT_MAX_PER_TURN) return undefined;
    const path = String(event.input?.path ?? event.input?.file ?? "");
    if (!lintablePath(path)) return undefined;
    if (!resolveBiome(cwd)) return undefined;
    return path;
  }

  pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
    const path = lintTarget(event, ctx.cwd);
    if (!path) return;
    lintsThisTurn += 1;
    try {
      const biome = resolveBiome(ctx.cwd) ?? "biome";
      const res = await pi.exec(biome, ["check", path], { timeout: LINT_TIMEOUT_MS });
      const note = formatLintNote(path, res.stdout ?? "");
      if (!note) return;
      return { content: [...event.content, { type: "text", text: note }] };
    } catch {
      return; // best-effort only
    }
  });

  // ---- 8) compaction state preservation (Claude Code PreCompact pattern) ----
  // When the session compacts, in-flight work would be lost from context.
  // Feed the outstanding mutation buffer into the compaction summary so the
  // post-compact agent can pick up where it left off.
  pi.on("session.compacting", (_event, ctx: ExtensionContext) => {
    const lines = [`project: ${projectFor(ctx.cwd)}`];
    if (buffer.length > 0) {
      lines.push("In-flight work (do not drop):");
      lines.push(...buffer.map((b) => `- ${b}`));
    }
    return { context: lines };
  });

  // ---- 2) buffer significant mutations ----
  pi.on("tool_result", (event: ToolResultEvent) => {
    const note = toolNote(event);
    if (note && buffer.length < 8) buffer.push(note);
  });

  // Flush the turn's mutations to engram at turn end.
  pi.on("turn_end", (_event, ctx: ExtensionContext) => {
    if (buffer.length === 0) return;
    const body = buffer.join("\n");
    buffer.length = 0;
    saveMemory(`work: ${projectFor(ctx.cwd)}`, body, "observation", ctx.cwd);
  });

  // Durable session summary so future sessions can recall this run.
  pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
    const proj = projectFor(ctx.cwd);
    const title = `session_summary: ${proj}`;
    const body =
      buffer.length > 0 ? `Notable actions:\n${buffer.join("\n")}` : "Session completed.";
    saveMemory(title, body, "session_summary", ctx.cwd);
  });

  // ---- 3) turn-start retrieval: surface prior recorded solutions -------
  const RETRIEVE_ON = () =>
    typeof process !== "undefined" && process.env?.PI_INTEGRATION_RETRIEVE === "1";
  const EVERY_TURN = () =>
    typeof process !== "undefined" && process.env?.PI_RETRIEVE_EVERY_TURN === "1";
  const RETRIEVE_TIMEOUT_MS = 2500;
  const RETRIEVE_LIMIT = 6; // max memories to recall
  const RETRIEVE_MAX_CHARS = 1800; // hard cap on the injected context block
  let retrievedThisSession = false;

  // Function words that add no search signal (static membership table).
  const STOPWORDS: Record<string, true> = {
    the: true,
    a: true,
    an: true,
    is: true,
    are: true,
    was: true,
    were: true,
    be: true,
    been: true,
    being: true,
    to: true,
    of: true,
    in: true,
    on: true,
    for: true,
    and: true,
    or: true,
    but: true,
    not: true,
    no: true,
    you: true,
    your: true,
    we: true,
    our: true,
    i: true,
    it: true,
    its: true,
    this: true,
    that: true,
    with: true,
    as: true,
    at: true,
    by: true,
    from: true,
    they: true,
    them: true,
    he: true,
    she: true,
    their: true,
    there: true,
    these: true,
    those: true,
    what: true,
    when: true,
    where: true,
    why: true,
    how: true,
    do: true,
    does: true,
    did: true,
    done: true,
    would: true,
    could: true,
    should: true,
    can: true,
    will: true,
    may: true,
    might: true,
    just: true,
    also: true,
    more: true,
    most: true,
    about: true,
    into: true,
    over: true,
    under: true,
    again: true,
    // biome-ignore lint/suspicious/noThenProperty: keyword stopword; table is only index-accessed, never awaited.
    then: true,
    than: true,
    so: true,
    if: true,
    which: true,
    who: true,
    whom: true,
  };

  /**
   * Distill a prompt into a short keyword query (≤N significant tokens). The
   * engram CLI search is keyword-sensitive — a verbose prompt matches nothing
   * while a couple of key terms do — so keep only meaningful content words.
   */
  function distillQuery(prompt: string, max: number): string {
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const raw of prompt.toLowerCase().split(/[^a-z0-9]+/)) {
      const t = raw.trim();
      if (t.length < 3) continue;
      if (STOPWORDS[t]) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      tokens.push(t);
      if (tokens.length >= max) break;
    }
    return tokens.join(" ");
  }

  /**
   * Compact engram search output into a short, model-directed block.
   * Returns the text to inject, or null when nothing useful was found.
   */
  function formatRetrieval(stdout: string): string | null {
    const lines: string[] = [];
    for (const raw of stdout.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^\s*(?:Found|no memories found|wall time|session\s*completed\.?)/i.test(line))
        continue;
      // Match the engram CLI block header: "[1] #611 (session_summary) — title"
      if (/^\[\d+\]\s+#\d+/.test(line)) {
        const m = line.match(/—\s*(.*)$/);
        lines.push(m?.[1] ?? line);
        continue;
      }
      lines.push(line);
    }
    if (lines.length === 0) return null;
    let joined = lines.join("\n").trim();
    if (joined.length > RETRIEVE_MAX_CHARS)
      joined = `${joined.slice(0, RETRIEVE_MAX_CHARS)}\n…(truncated)`;
    return joined;
  }

  // Injects prior-session context before the agent loop. Best-effort and
  // bounded: a failure/timeout returns undefined so the turn is never blocked.
  pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
    if (!RETRIEVE_ON()) return undefined;
    const proj = projectFor(ctx.cwd);
    if (!EVERY_TURN() && retrievedThisSession) return undefined;
    retrievedThisSession = true;

    const raw = event.prompt.trim() || proj;
    const distilled = distillQuery(raw, 4);
    try {
      // 1) Best attempt: keyword search on a distilled query derived from the prompt.
      let res = await pi.exec(
        "engram",
        ["search", distilled || raw, "--project", proj, "--limit", String(RETRIEVE_LIMIT)],
        { timeout: RETRIEVE_TIMEOUT_MS },
      );
      let text = formatRetrieval(res.stdout ?? "");

      // 2) Keyword matching is brittle — if nothing matched, fall back to the
      //    project's recent recorded context so the agent still sees prior work.
      if (!text) {
        res = await pi.exec("engram", ["search", proj, "--project", proj, "--limit", "4"], {
          timeout: RETRIEVE_TIMEOUT_MS,
        });
        text = formatRetrieval(res.stdout ?? "");
      }

      if (!text) return undefined;
      return {
        message: {
          customType: "omp-retrieval",
          content:
            "Prior recorded context for this project (from engram) — reuse it when relevant to save time:\n\n" +
            text,
          display: false,
          attribution: "agent",
        },
      };
    } catch {
      /* retrieval must never break the loop */
      return undefined;
    }
  });

  pi.setLabel("engram-rtk-leanctx");
}
