// Post-edit lint feedback helpers.
//
// Implements the Claude Code PostToolUse "enforcement layer" pattern: after a
// successful edit/write of a TS file, run biome on that file and surface any
// diagnostics in the tool result so the agent fixes them immediately instead
// of discovering them at the next verify gate (shift-left; ties rule
// strict-types-and-reuse / compact-single-responsibility-functions).
//
// Pure helpers live here for unit tests; the wiring is in extensions/index.ts.
// Best-effort by design: no biome on PATH or any failure → silent, the agent
// loop is never blocked or broken.

/** Only repo source files are lint-worthy. */
export function lintablePath(path: string): boolean {
  if (!path) return false;
  if (path.includes("node_modules")) return false;
  return /\.tsx?$/.test(path);
}

const DIAG_RE = /:\d+:\d+\s+(?:lint|parse|check)\/\S+/;

/**
 * Compact biome diagnostics into a short tool-result note, or undefined when
 * the file is clean. Drops biome's decorative frames; keeps rule ids and
 * locations. Bounded to the first 6 diagnostics.
 */
export function formatLintNote(file: string, stdout: string): string | undefined {
  const diags = stdout.split(/\r?\n/).filter((line) => DIAG_RE.test(line));
  if (diags.length === 0) return undefined;
  const shown = diags.slice(0, 6).map((line) => `- ${line.trim()}`);
  if (diags.length > 6) shown.push(`- …${diags.length - 6} more`);
  return (
    `\n[biome] ${file}: ${diags.length} lint issue(s) — fix before proceeding:\n` + shown.join("\n")
  );
}
