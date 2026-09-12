import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// bashInterceptor (agent/config.yml) already forces raw shell reads/greps/
// finds/ls onto the native `read`/`grep`/`glob` tools. This hook escalates
// one layer further: the lean-ctx MCP server instructions mandate
// ctx_read/ctx_search/ctx_glob over the native tools outright (cached
// re-reads, anchored patch, semantic/symbol search — deeper compression
// than the native tools alone give). Escalating this was deliberately
// deferred until lean-ctx MCP uptime was confirmed (user: daily-driven for
// months) — a hard block here has no fallback if the MCP server is down.
//
// Only blocks plain filesystem paths inside the process working directory
// (project root). Exemptions keep AGENTS.md's documented fallbacks true:
// internal URI schemes (memory://, skill://, agent://, history://,
// artifact://, local://, mcp://, issue://, pr://, omp://, ssh://) and
// binary/document/archive/sqlite paths — ctx_read/ctx_search/ctx_glob/
// ctx_patch are source-code tools and don't cover those. Paths outside the
// project root are exempt too — ctx_* are confined to the project root
// (+ allow_paths), so the native tools remain the sanctioned fallback there
// instead of a dead end.
//
// The native `edit` tool is routed to `ctx_patch` (anchored, hash-validated
// patching) under the same exemptions: in-root source-file edits must go
// through ctx_read(mode="anchored") + ctx_patch so line drift cannot silently
// corrupt a hunk; everything else keeps the native escape hatches.
//
// The native `write` tool is gated to the repo scratchpad: native writes are
// allowed only inside the project root under a `.tmp/` directory (the
// documented scratch convention, any depth — `./.tmp/x`, `a/.tmp/x`,
// `a/b/.tmp/x`). In-root non-scratch creation routes to `ctx_patch`
// (op: create); files outside the project root are blocked too — out-of-root
// writes go through trusted bash/installer flows instead of ad-hoc native
// writes. URI/binary exemptions still apply (ctx_patch can't create those).

const URI_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const INTERNAL_SCHEME_RE =
  /^(memory|skill|rule|agent|history|artifact|local|mcp|issue|pr|omp|ssh|xd):/i;
const EXEMPT_EXT_RE =
  /\.(png|jpe?g|gif|svg|webp|bmp|ico|pdf|docx?|xlsx?|pptx?|ipynb|zip|tar(\.gz)?|tgz|jar|war|ear|apk|db3?|sqlite3?)(:[^/]*)?$/i;

function isExempt(path: string): boolean {
  if (!path) return true;
  if (URI_RE.test(path) || INTERNAL_SCHEME_RE.test(path)) return true;
  if (EXEMPT_EXT_RE.test(path)) return true;
  return false;
}

function isOutsideRoot(path: string): boolean {
  const rel = relative(process.cwd(), resolve(path));
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

export const READ_DIR_REASON =
  "Use `mcp__lean_ctx_ctx_tree` instead of `read` on a directory — compact per-directory file counts, respects .gitignore.";
export const READ_FILE_REASON =
  "Use `mcp__lean_ctx_ctx_read` instead of `read` — cached, mode-aware (anchored/full/map/signatures), ~13 tokens on re-read.";
export const GREP_REASON =
  "Use `mcp__lean_ctx_ctx_search` instead of `grep` — regex/semantic/symbol search with compact results.";
export const GLOB_REASON =
  "Use `mcp__lean_ctx_ctx_glob` instead of `glob` — respects .gitignore and matches faster.";
export const EDIT_REASON =
  "Use `mcp__lean_ctx_ctx_patch` instead of `edit` — anchored, hash-validated patches " +
  '(run `ctx_read` with mode="anchored" first). `ctx_patch` ops: set_line, replace_lines, ' +
  "insert_after, delete, replace_unique, replace_symbol, replace_all, create.";

export function editBlockReason(path: string): { block: true; reason: string } | undefined {
  if (path && (isExempt(path) || isOutsideRoot(path))) return undefined;
  return { block: true, reason: EDIT_REASON };
}
export function readBlockReason(path: string): { block: true; reason: string } | undefined {
  if (!path) return undefined;
  // Trailing `:<selector>` (`file.ts:50-200`, `:raw`, `:img?q=`) is read-tool
  // path syntax, not a filesystem path — strip it or statSync fails, the
  // non-existent-path fallback fires, and selector reads silently bypass.
  const plain = path.replace(/:[^/]*$/, "");
  if (isExempt(plain) || isOutsideRoot(plain)) return undefined;
  let isDir = false;
  try {
    isDir = statSync(plain).isDirectory();
  } catch {
    // Path doesn't resolve locally (may still be tool-specific) — let the
    // native tool report the real error rather than mask it.
    return undefined;
  }
  return { block: true, reason: isDir ? READ_DIR_REASON : READ_FILE_REASON };
}
export function grepBlockReason(path: string): { block: true; reason: string } | undefined {
  if (path && (isExempt(path) || isOutsideRoot(path))) return undefined;
  return { block: true, reason: GREP_REASON };
}

export function globBlockReason(path: string): { block: true; reason: string } | undefined {
  if (path && (isExempt(path) || isOutsideRoot(path))) return undefined;
  return { block: true, reason: GLOB_REASON };
}

export const WRITE_REASON =
  "Use `mcp__lean_ctx_ctx_patch` (op: `create`) instead of `write` — anchored, hash-validated creation. " +
  "Throwaway files belong in an in-root `.tmp/` scratch dir, where native `write` is allowed.";
export const WRITE_OUTSIDE_REASON =
  "Native `write` is allowed only for in-root `.tmp/` scratch files. For files outside the project root " +
  "use the native `bash` tool or the project installer.";

function isUnderTmpDir(path: string): boolean {
  const rel = relative(process.cwd(), resolve(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  return rel.split(/[\\/]/).includes(".tmp");
}

export function writeBlockReason(path: string): { block: true; reason: string } | undefined {
  if (!path || isExempt(path)) return undefined;
  if (isUnderTmpDir(path)) return undefined;
  return {
    block: true,
    reason: isOutsideRoot(path) ? WRITE_OUTSIDE_REASON : WRITE_REASON,
  };
}

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    const { toolName, input } = event;
    if (toolName === "read") return readBlockReason(String(input.path ?? ""));
    if (toolName === "grep") return grepBlockReason(input.path ? String(input.path) : "");
    if (toolName === "glob") return globBlockReason(input.path ? String(input.path) : "");
    if (toolName === "edit") return editBlockReason(input.path ? String(input.path) : "");
    if (toolName === "write") return writeBlockReason(input.path ? String(input.path) : "");
  });
}
