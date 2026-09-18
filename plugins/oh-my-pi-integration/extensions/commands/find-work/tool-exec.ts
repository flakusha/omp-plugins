/**
 * `/find-work` subprocess helpers: the bounded exec wrapper shared by the
 * merge-queue scan, tool-cluster runners, and doctor bridge, plus repo-
 * pinned binary resolution and small formatting utilities.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Minimal exec surface used by every find-work subprocess call. */
export interface ExecLike {
  exec(
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<{ stdout?: string }>;
}

/** Per-tool timeout cap: min(tool constant, tool-cluster budget left). */
export type ToolCap = (ms: number) => number;

/**
 * Run a tool CLI best-effort and return stdout. Linters, typecheckers, and
 * test runners exit nonzero precisely when they have findings, so a thrown
 * exec error still yields its stdout when the harness attaches it; only a
 * truly empty failure rethrows (caller turns it into a warning).
 */
export async function execTool(
  pi: ExecLike,
  command: string,
  args: string[],
  timeout: number,
): Promise<string> {
  try {
    const res = await pi.exec(command, args, { timeout });
    return res.stdout ?? "";
  } catch (err) {
    const out = (err as { stdout?: unknown })?.stdout;
    if (typeof out === "string" && out.trim().length > 0) return out;
    throw err;
  }
}

/** Prefer the repo-pinned binary; fall back to PATH. */
export function toolBin(root: string, name: string): string {
  const local = join(root, "node_modules", ".bin", name);
  try {
    if (existsSync(local)) return local;
  } catch {
    /* fall through to PATH */
  }
  return name;
}

/** `01`, `02`, … ticket sequence suffix. */
export function pad2(i: number): string {
  return String(i + 1).padStart(2, "0");
}

/** Repo-relative display path when under root; raw otherwise. */
export function relToRoot(root: string, file: string): string {
  const f = file.trim();
  if (f.startsWith(`${root}/`)) return f.slice(root.length + 1);
  return f;
}
