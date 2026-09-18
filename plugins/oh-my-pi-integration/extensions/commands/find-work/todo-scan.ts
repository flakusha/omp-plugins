/**
 * `/find-work` TODO/FIXME comment scan: a bounded walk over source files that
 * maps comment markers to tickets (FIXME → bug/P2, TODO → task/P3).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// TODO/FIXME comment scan
// ---------------------------------------------------------------------------

/** Comment markers that become work tickets (word-boundary, case-insensitive). */
export const TODO_MARKER_RE = /\b(TODO|FIXME)\b/i;

/** File extensions scanned for TODO/FIXME comments (code + scripts + styles). */
const TODO_EXTS: Record<string, true> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".jsx": true,
  ".mjs": true,
  ".cjs": true,
  ".mts": true,
  ".cts": true,
  ".py": true,
  ".go": true,
  ".rs": true,
  ".java": true,
  ".kt": true,
  ".rb": true,
  ".php": true,
  ".swift": true,
  ".c": true,
  ".h": true,
  ".cpp": true,
  ".hpp": true,
  ".cs": true,
  ".sh": true,
  ".bash": true,
  ".zsh": true,
  ".css": true,
  ".scss": true,
  ".html": true,
  ".vue": true,
  ".svelte": true,
  ".sql": true,
  ".lua": true,
};

/** Test fixture dirs never hold actionable TODOs (scaffold noise). */
const TODO_TEST_DIRS: Record<string, true> = {
  __tests__: true,
  tests: true,
  test: true,
  spec: true,
  fixtures: true,
  testdata: true,
  __snapshots__: true,
};

/** Test file stems never hold actionable TODOs (`a.test.ts`, `test_x.py`). */
function isTestFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  const stem = (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
  const lower = name.toLowerCase();
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    stem.startsWith("test_") ||
    stem.startsWith("test-") ||
    stem.endsWith("_test") ||
    stem.endsWith("-test")
  );
}

/** The marker must sit inside a comment (`//`, `#`, `/*`, `*`, …) —
 *  bare identifiers in string literals and ternaries are not work items.
 *  Descriptions shorter than 2 chars are not actionable — skip them. */
const TODO_COMMENT_BEFORE_RE = /(^|\s)(?:\/\/|#|\/\*|\*|<!--|--|%|;)/;
const TODO_MIN_TEXT = 2;

/** Directories never descended into (deps, build output, VCS, scratch). */
export const TODO_SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  target: true,
  dist: true,
  build: true,
  ".next": true,
  ".nuxt": true,
  coverage: true,
  vendor: true,
  ".venv": true,
  venv: true,
  __pycache__: true,
  ".turbo": true,
  ".parcel-cache": true,
  ".tmp": true,
  ".plan": true,
  ".omp": true,
  ".serena": true,
  ".vscode": true,
  ".idea": true,
};

/** Guardrails: files scanned, bytes per file, tickets surfaced. */
export const TODO_MAX_FILES = 600;
export const TODO_MAX_FILE_BYTES = 200_000;
export const TODO_MAX_TICKETS = 30;

/** One matched TODO/FIXME line, before ticket mapping. */
export interface TodoMatch {
  file: string;
  line: number;
  marker: "TODO" | "FIXME";
  text: string;
}

export function todoExt(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && (TODO_EXTS[name.slice(dot).toLowerCase()] ?? false);
}

/** Comment text after the marker, with comment syntax and separators stripped. */
export function todoCommentText(line: string, marker: string): string {
  const at = line.search(new RegExp(`\\b${marker}\\b`, "i"));
  const after = at >= 0 ? line.slice(at + marker.length) : line;
  return after
    .replace(/^[\s:([-]*/, "")
    .replace(/(\*\/|-->)\s*$/, "")
    .trim();
}

/** Collect candidate source files under root, honoring skip dirs and caps. */
function collectTodoFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < TODO_MAX_FILES) {
    const dir = stack.pop() as string;
    scanTodoDir(dir, out, stack);
  }
  return out;
}

interface TodoEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** Hidden dirs skip unless explicitly known (else unknown dot-dirs scan). */
function skipHiddenDir(entry: TodoEntry): boolean {
  if (!entry.name.startsWith(".") || !entry.isDirectory) return false;
  // Files at root level like .giwt.toml are handled by the extension
  // filter below; unknown hidden dirs are skipped to avoid scratch/VCS.
  return TODO_SKIP_DIRS[entry.name] ?? true;
}

/** Scan one directory: queue subdirs, collect matching files (bounded). */
function scanTodoDir(dir: string, out: string[], stack: string[]): void {
  let entries: TodoEntry[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (out.length >= TODO_MAX_FILES) return;
    if (skipHiddenDir(entry)) continue;
    if (entry.isDirectory) {
      if (TODO_SKIP_DIRS[entry.name] || TODO_TEST_DIRS[entry.name]) continue;
      stack.push(join(dir, entry.name));
    } else if (entry.isFile && !isTestFile(entry.name) && todoExt(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

/** Scan one file for TODO/FIXME lines; skips oversized/unreadable files. */
function scanTodoFile(abs: string): TodoMatch[] {
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

/**
 * Scan code comments for TODO/FIXME markers. FIXME → bug/P2, TODO → task/P3.
 * Hidden dirs, vendored deps, build output, and markdown docs are excluded.
 * Bounded (file count, file size, ticket cap) — best-effort, never throws.
 */
export function todoTickets(root: string): WorkTicket[] {
  let files: string[];
  try {
    files = collectTodoFiles(root);
  } catch {
    return [];
  }
  const matches: TodoMatch[] = [];
  for (const file of files) {
    try {
      matches.push(...scanTodoFile(file));
    } catch {
      continue;
    }
    if (matches.length >= TODO_MAX_TICKETS * 2) break;
  }
  matches.sort((a, b) => {
    if (a.marker !== b.marker) return a.marker === "FIXME" ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
  return matches.slice(0, TODO_MAX_TICKETS).map((m, i) => {
    const rel = relative(root, m.file);
    const head = rel.split("/")[0] ?? rel;
    return {
      id: `TD-${String(i + 1).padStart(2, "0")}`,
      title: `${m.marker}: ${m.text || "(no description)"} (${rel}:${m.line})`,
      source: "todo",
      kind: m.marker === "FIXME" ? ("bug" as const) : ("task" as const),
      priority: m.marker === "FIXME" ? "P2" : "P3",
      domain: head && head !== rel ? head : "root",
    };
  });
}
