/**
 * `/find-work` per-file work-marker scan: comment-context detection and
 * marker text extraction, consumed by the bounded walk in todo-scan.ts.
 */

import { readFileSync, statSync } from "node:fs";

/** Comment markers that become work tickets (word-boundary, case-insensitive). */
export const TODO_MARKER_RE = /\b(TODO|FIXME)\b/i;

/** Max bytes per scanned file — oversized blobs are skipped, never parsed. */
export const TODO_MAX_FILE_BYTES = 200_000;

/** One matched marker line, before ticket mapping. */
export interface TodoMatch {
  file: string;
  line: number;
  marker: "TODO" | "FIXME";
  text: string;
}

/** The marker must sit inside a comment (`//`, `#`, `/*`, `*`, …) —
 *  bare identifiers in string literals and ternaries are not work items.
 *  Descriptions shorter than 2 chars are not actionable — skip them. */
const TODO_COMMENT_BEFORE_RE = /(^|\s)(?:\/\/|#|\/\*|\*|<!--|--|%|;)/;
const TODO_MIN_TEXT = 2;

/** Comment text after the marker, with comment syntax and separators stripped. */
export function todoCommentText(line: string, marker: string): string {
  const at = line.search(new RegExp(`\\b${marker}\\b`, "i"));
  const after = at >= 0 ? line.slice(at + marker.length) : line;
  return after
    .replace(/^[\s:([-]*/, "")
    .replace(/(\*\/|-->)\s*$/, "")
    .trim();
}

/** Scan one file for marker lines; skips oversized/unreadable files. */
export function scanTodoFile(abs: string): TodoMatch[] {
  let text: string;
  try {
    if (statSync(abs).size > TODO_MAX_FILE_BYTES) return [];
    text = readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  const matches: TodoMatch[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length > 500) continue; // minified/blob line
    const m = TODO_MARKER_RE.exec(line);
    if (!m?.[1]) continue;
    if (!TODO_COMMENT_BEFORE_RE.test(line.slice(0, m.index))) continue;
    const marker = m[1].toUpperCase() === "FIXME" ? "FIXME" : "TODO";
    const text = todoCommentText(line, marker);
    if (text.length < TODO_MIN_TEXT) continue;
    matches.push({ file: abs, line: i + 1, marker, text });
  }
  return matches;
}
