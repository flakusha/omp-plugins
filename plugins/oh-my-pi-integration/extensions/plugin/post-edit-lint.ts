/**
 * Post-edit lint feedback (Claude Code PostToolUse pattern), wired onto the
 * plugin factory's `pi`. Pure formatting helpers live in ../util/lint-feedback.
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { formatLintNote, lintablePath } from "../util/lint-feedback";

/** Register the per-turn bounded biome feedback on edit/write tool results. */
export function registerPostEditLint(pi: ExtensionAPI): void {
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
}
