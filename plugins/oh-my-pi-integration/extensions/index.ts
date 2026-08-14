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

import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { GIT_DESTRUCTIVE_NOTICE, isDestructiveGitCommand } from "./guards/git-destructive-guard";
import { GPG_BLOCK_REASON, gpgSignHardStop, isGpgTamperCommand } from "./guards/gpg-guard";
import { isSshTamperCommand, SSH_BLOCK_REASON, sshSockHardStop } from "./guards/ssh-guard";
import { formatLintNote, lintablePath } from "./lint-feedback";

const DISABLE = () => typeof process !== "undefined" && process.env?.PI_INTEGRATION_DISABLE === "1";

/**
 * rtk subcommands that duplicate/subsume common shell read-only calls. Prepending
 * `rtk` to an already-simple command yields compact, token-trimmed output.
 */
const RTK_SUBCOMMANDS = new Set([
  "read",
  "ls",
  "tree",
  "git",
  "find",
  "grep",
  "rg",
  "wc",
  "diff",
  "log",
  "env",
  "json",
  "summary",
  "deps",
  "docker",
  "kubectl",
  "test",
  "psql",
]);

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
  return m ? m[1] : "";
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

  const bin = firstToken(cmd);

  // 1) rtk output-trimming: exact rtk subcommand names on simple calls.
  if (RTK_SUBCOMMANDS.has(bin)) {
    // `rtk read|ls|git|find|grep|wc|diff|log|... <args>` — same argv shape.
    return `rtk ${cmd}`;
  }

  // 2) lean-ctx compression for any other simple command (git, npm, etc.).
  //    Only when lean-ctx is present; `rtk` lacks a generic passthrough.
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
        lines.push((line.match(/—\s*(.*)$/) || ["", line])[1]);
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
