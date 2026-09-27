/**
 * Pure-fs `.tmp` scratchpad hygiene for `/bookkeep scratch` — no subprocess
 * anywhere. Divergence from giwt is deliberate and recorded here: `giwt
 * clean` has no --dry-run (a bare invocation REMOVES worktrees) and `giwt
 * doctor` has no scratchpad check, so this summary is computed straight
 * from the filesystem (giwt G-3/G-4 pending — revisit if giwt grows a
 * read-only scratchpad report).
 */

import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

/** Hard bounds so a runaway `.tmp` cannot stall a completion render. */
const MAX_TMP_FILES = 5000;
const MAX_TEXT_FILES = 5000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Deepest glob group count reported by the summary table. */
const TOP_GLOB_COUNT = 5;

/** Trees whose text files may legitimately reference a scratch artifact. */
const REFERENCE_DIRS = [".plan", "docs", "src"] as const;

/** Text extensions whose files may reference a scratch artifact by name. */
const REFERENCE_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
]);

export interface ScratchSummary {
  totalBytes: number;
  fileCount: number;
  orphanCount: number;
  oldestPath: string | null;
  oldestMtime: number | null;
  topGlobs: Array<{ glob: string; bytes: number }>;
}

/** One regular file under `<root>/.tmp`. `rel` is relative to `root`. */
interface TmpFile {
  rel: string;
  bytes: number;
  mtimeMs: number;
}

/** Locale-independent deterministic string order (shared by every sort). */
function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Walked-entry classification: recurse, stat, or ignore. */
type EntryKind = "dir" | "file" | "skip";

/** Symlinks are never followed; anything but dir/file is ignored. */
function classifyEntry(entry: Dirent): EntryKind {
  if (entry.isSymbolicLink()) return "skip";
  if (entry.isDirectory()) return "dir";
  return entry.isFile() ? "file" : "skip";
}

/** Sorted Dirent list, or null when the dir cannot be read (fail-open). */
function readEntries(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => byString(a.name, b.name));
  } catch {
    return null;
  }
}

/** Push one stat'ed file; skip silently when it vanishes mid-walk. */
function appendStat(files: TmpFile[], full: string, rel: string): void {
  try {
    const st = statSync(full);
    files.push({ rel, bytes: st.size, mtimeMs: st.mtimeMs });
  } catch {
    // vanished mid-walk — skip
  }
}

/**
 * Walk `<root>/.tmp` recursively: symlinks skipped, entries sorted,
 * capped at MAX_TMP_FILES; fail-open on unreadable/vanished entries.
 */
function collectTmpFiles(root: string): TmpFile[] {
  const tmpRoot = join(root, ".tmp");
  if (!existsSync(tmpRoot)) return [];
  const files: TmpFile[] = [];
  collectInto(files, tmpRoot, ".tmp");
  return files.sort((a, b) => byString(a.rel, b.rel));
}

/** Depth-first `.tmp` walk; returns silently once the file cap is hit. */
function collectInto(files: TmpFile[], dir: string, relDir: string): void {
  const entries = readEntries(dir);
  if (entries === null) return;
  for (const entry of entries) {
    if (files.length >= MAX_TMP_FILES) return;
    const kind = classifyEntry(entry);
    if (kind === "skip") continue;
    const full = join(dir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    if (kind === "dir") collectInto(files, full, rel);
    else appendStat(files, full, rel);
  }
}

/** True when a walked file's extension makes it a reference candidate. */
function isReferenceText(name: string): boolean {
  return REFERENCE_EXTENSIONS.has(extname(name).toLowerCase());
}

/** Read one corpus file (first MAX_TEXT_BYTES at most); spends one budget unit. */
function appendCapped(parts: string[], budget: { left: number }, full: string): void {
  try {
    const raw = readFileSync(full);
    parts.push(
      raw.length > MAX_TEXT_BYTES
        ? raw.subarray(0, MAX_TEXT_BYTES).toString("utf8")
        : raw.toString("utf8"),
    );
    budget.left--;
  } catch {
    // unreadable — skip
  }
}

/**
 * Concatenated text of `.plan/`, `docs/`, `src/` directly under root
 * (literal — the bare-audit prompt probes the same three dirs). Only known
 * text extensions; MAX_TEXT_FILES budget shared across the trees. Pure fs.
 */
function referenceCorpus(root: string): string {
  const parts: string[] = [];
  const budget = { left: MAX_TEXT_FILES };
  for (const rel of REFERENCE_DIRS) {
    const dir = join(root, rel);
    if (existsSync(dir)) collectTextInto(parts, budget, dir);
  }
  return parts.join("\n");
}

/** Depth-first text-tree walk; stops once the shared budget is spent. */
function collectTextInto(parts: string[], budget: { left: number }, dir: string): void {
  const entries = readEntries(dir);
  if (entries === null) return;
  for (const entry of entries) {
    if (budget.left <= 0) return;
    const kind = classifyEntry(entry);
    if (kind === "skip") continue;
    const full = join(dir, entry.name);
    if (kind === "dir") {
      collectTextInto(parts, budget, full);
      continue;
    }
    if (isReferenceText(entry.name)) appendCapped(parts, budget, full);
  }
}

/** Count `.tmp` files whose basename appears in no reference-corpus file
 *  (case-sensitive substring); shared by scratchSummary and orphanTmpCount. */
function countOrphans(files: TmpFile[], root: string): number {
  if (files.length === 0) return 0;
  const corpus = referenceCorpus(root);
  const seen = new Map<string, boolean>();
  let orphans = 0;
  for (const file of files) {
    const name = basename(file.rel);
    let referenced = seen.get(name);
    if (referenced === undefined) {
      referenced = corpus.includes(name);
      seen.set(name, referenced);
    }
    if (!referenced) orphans++;
  }
  return orphans;
}

/** Top first-path-segment groups by bytes ('*' for root-level files). */
function topGlobsOf(files: TmpFile[]): Array<{ glob: string; bytes: number }> {
  const groups = new Map<string, number>();
  for (const file of files) {
    const rest = file.rel.slice(".tmp/".length);
    const glob = rest.includes("/") ? `${rest.split("/")[0]}/*` : "*";
    groups.set(glob, (groups.get(glob) ?? 0) + file.bytes);
  }
  return [...groups.entries()]
    .map(([glob, bytes]) => ({ glob, bytes }))
    .sort((a, b) => b.bytes - a.bytes || byString(a.glob, b.glob))
    .slice(0, TOP_GLOB_COUNT);
}

/** Pure-fs `.tmp` summary: bytes, files, orphans, oldest artifact, top globs. */
export function scratchSummary(root: string): ScratchSummary {
  const files = collectTmpFiles(root);
  let totalBytes = 0;
  let oldest: TmpFile | null = null;
  for (const file of files) {
    totalBytes += file.bytes;
    if (!oldest || file.mtimeMs < oldest.mtimeMs) oldest = file;
  }
  return {
    totalBytes,
    fileCount: files.length,
    orphanCount: countOrphans(files, root),
    oldestPath: oldest?.rel ?? null,
    oldestMtime: oldest?.mtimeMs ?? null,
    topGlobs: topGlobsOf(files),
  };
}

/** Pure-fs orphan count: `.tmp` files referenced by name nowhere. */
export function orphanTmpCount(root: string): number {
  return countOrphans(collectTmpFiles(root), root);
}

/** Humanize a byte count as B / KiB / MiB (deterministic, 1 decimal). */
function humanBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

/** Human table for `notify`: bytes, count, orphans, oldest, top globs. */
export function formatScratchSummary(s: ScratchSummary, orphans: number): string {
  if (s.fileCount === 0 && s.totalBytes === 0) {
    return ".tmp scratchpad: (no .tmp dir) — nothing to audit";
  }
  const lines = [
    ".tmp scratchpad summary:",
    `  total:   ${humanBytes(s.totalBytes)} (${s.totalBytes} bytes) across ${s.fileCount} file(s)`,
    `  orphans: ${orphans} (basename referenced by zero files in .plan/, docs/, src/)`,
  ];
  if (s.oldestPath !== null && s.oldestMtime !== null) {
    lines.push(`  oldest:  ${s.oldestPath} (${new Date(s.oldestMtime).toISOString()})`);
  }
  if (s.topGlobs.length > 0) {
    lines.push("  top globs (by bytes):");
    for (const g of s.topGlobs) lines.push(`    ${g.glob}  ${humanBytes(g.bytes)}`);
  }
  return lines.join("\n");
}
