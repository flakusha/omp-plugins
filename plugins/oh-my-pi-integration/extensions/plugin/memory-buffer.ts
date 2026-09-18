/**
 * Per-session buffer of notable mutations, flushed to engram at turn end,
 * carried into compaction summaries, and summarized at session shutdown.
 */

import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { projectFor } from "../commands/commands/recall";

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

/** Register the mutation buffer, turn-end flush, compaction feed, and shutdown summary. */
export function registerMemoryBuffer(pi: ExtensionAPI): void {
  // Per-session buffer of notable mutations for this turn.
  const buffer: string[] = [];

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
}
