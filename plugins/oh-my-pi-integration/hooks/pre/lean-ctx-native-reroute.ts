import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// bashInterceptor (agent/config.yml) already forces raw shell reads/greps/
// finds/ls onto the native `read`/`grep`/`glob` tools. This hook escalates
// one layer further: agent/CLAUDE.md's lean-ctx server instructions mandate
// ctx_read/ctx_search/ctx_glob over the native tools outright (cached
// re-reads, anchored patch, semantic/symbol search — deeper compression
// than the native tools alone give). Escalating this was deliberately
// deferred until lean-ctx MCP uptime was confirmed (user: daily-driven for
// months) — a hard block here has no fallback if the MCP server is down.
//
// Only blocks plain filesystem paths inside the process working directory
// (project root). Two exemptions keep AGENTS.md's documented fallbacks true:
// internal URI schemes (memory://, skill://, agent://, history://,
// artifact://, local://, mcp://, issue://, pr://, omp://, ssh://) and
// binary/document/archive/sqlite paths are exempt — ctx_read/ctx_search/
// ctx_glob are source-code tools and don't cover those; blocking them would
// break image/PDF/notebook/archive/sqlite reads with no working alternative.
// Paths outside the project root are exempt too — ctx_read/ctx_search/
// ctx_glob are confined to the project root (+ allow_paths), so native
// read/grep/glob remain the sanctioned fallback there instead of a dead end.

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

export function readBlockReason(path: string): { block: true; reason: string } | undefined {
  if (isExempt(path) || isOutsideRoot(path)) return undefined;
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
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

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    const { toolName, input } = event;

    if (toolName === "read") return readBlockReason(String(input.path ?? ""));
    if (toolName === "grep") return grepBlockReason(input.path ? String(input.path) : "");
    if (toolName === "glob") return globBlockReason(input.path ? String(input.path) : "");
  });
}
