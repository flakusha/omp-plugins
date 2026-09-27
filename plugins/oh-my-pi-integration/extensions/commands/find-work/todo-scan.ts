/**
 * `/find-work` work-marker comment scan: a bounded walk over source files
 * that maps defect markers to bug/P2 tickets and deferred markers to task/P3.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { scanTodoFile, type TodoMatch } from "./todo-comment";
import type { WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// work-marker comment scan
// ---------------------------------------------------------------------------

/** File extensions scanned for work-marker comments (code + scripts + styles). */
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

/** Guardrails: files scanned, tickets surfaced. */
export const TODO_MAX_FILES = 600;
export const TODO_MAX_TICKETS = 30;

export type { TodoMatch } from "./todo-comment";
export { TODO_MARKER_RE, TODO_MAX_FILE_BYTES, todoCommentText } from "./todo-comment";

export function todoExt(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && (TODO_EXTS[name.slice(dot).toLowerCase()] ?? false);
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

/** True when a directory entry must not be descended into (skip lists,
 *  test fixtures, nested checkouts). */
function skipDirEntry(dir: string, entry: TodoEntry): boolean {
  if (TODO_SKIP_DIRS[entry.name] || TODO_TEST_DIRS[entry.name]) return true;
  // Nested checkouts (giwt worktrees carry a `.git` file pointing at the
  // main repo; submodules and full clones carry a `.git` dir) are
  // duplicate surfaces of the same sources — never scanned.
  return existsSync(join(dir, entry.name, ".git"));
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
      if (skipDirEntry(dir, entry)) continue;
      stack.push(join(dir, entry.name));
    } else if (entry.isFile && !isTestFile(entry.name) && todoExt(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

/**
 * Scan code comments for work markers (defect marker → bug/P2, deferred
 * marker → task/P3). Hidden dirs, nested checkouts, vendored deps, build
 * output, and markdown docs are excluded.
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
