// Native tool reroute (pre-hook): escalate write/glob/edit to lean-ctx ctx_*.
//
// 2026-09-16: reinstated, trimmed from the hook removed in e63c9ed. The new
// rtk and lean-ctx releases integrate natively for bash (rtk installs its own
// `~/.omp/agent/extensions/rtk.ts`) and for wrapped agents (`lean-ctx wrap`),
// but lean-ctx has no omp wrap target — for omp the MCP server
// (`~/.omp/agent/mcp.json`) plus this hook is the whole integration. Scope is
// exactly the three tools whose native versions underperform:
//
//   edit  -> ctx_patch — anchored, hash-validated patching: one
//                       ctx_read(mode="anchored") + one ctx_patch instead of
//                       repeated fuzzy `edit` retries that fail on drift.
//   write -> ctx_patch (op: create) for in-root non-scratch creation. Native
//                       `write` remains allowed inside any `.tmp/` scratch dir
//                       (any depth); outside the project root native writes
//                       are blocked outright — out-of-root writes belong to
//                       trusted bash/installer flows, not ad-hoc tool calls.
//   glob  -> ctx_glob  — respects .gitignore, compact results.
//
// `read`/`grep` deliberately stay native: selector reads (`file.ts:50-200`,
// `:raw`, `:img?q=`) are heavily used with no ctx_* equivalent, and blocking
// them was the riskiest part of the old hook — not restored.
//
// Fail-open by exemption, mirroring ctx_* capabilities (source-code tools
// jailed to the project root): internal URI schemes (memory://, skill://,
// agent://, history://, artifact://, local://, mcp://, issue://, pr://,
// omp://, ssh://, xd://), binary/document/archive/sqlite paths, and paths
// outside the project root all pass through to the native tools — the
// sanctioned fallback, never a dead end.

import { isAbsolute, relative, resolve } from "node:path";
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

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

export const GLOB_REASON =
  "Use `mcp__lean_ctx_ctx_glob` instead of `glob` — respects .gitignore and matches faster.";
export const EDIT_REASON =
  "Use `mcp__lean_ctx_ctx_patch` instead of `edit` — anchored, hash-validated patches " +
  '(run `ctx_read` with mode="anchored" first). `ctx_patch` ops: set_line, replace_lines, ' +
  "insert_after, delete, replace_unique, replace_symbol, replace_all, create.";
export const WRITE_REASON =
  "Use `mcp__lean_ctx_ctx_patch` (op: `create`) instead of `write` — anchored, hash-validated creation. " +
  "Throwaway files belong in an in-root `.tmp/` scratch dir, where native `write` is allowed.";
export const WRITE_OUTSIDE_REASON =
  "Native `write` is allowed only for in-root `.tmp/` scratch files. For files outside the project root " +
  "use the native `bash` tool or the project installer.";

export function globBlockReason(path: string): { block: true; reason: string } | undefined {
  if (path && (isExempt(path) || isOutsideRoot(path))) return undefined;
  return { block: true, reason: GLOB_REASON };
}

export function editBlockReason(path: string): { block: true; reason: string } | undefined {
  if (path && (isExempt(path) || isOutsideRoot(path))) return undefined;
  return { block: true, reason: EDIT_REASON };
}

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
    if (toolName === "glob") return globBlockReason(input.path ? String(input.path) : "");
    if (toolName === "edit") return editBlockReason(String(input.path ?? ""));
    if (toolName === "write") return writeBlockReason(String(input.path ?? ""));
  });
}
