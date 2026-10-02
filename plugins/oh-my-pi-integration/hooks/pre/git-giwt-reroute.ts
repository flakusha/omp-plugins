// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

// git → giwt reroute (pre-hook): rewrite exact-argv `git` worktree/merge/rebase
// shapes to their `giwt` equivalents so giwt (ledger, finalize gates, GPG
// signing) is the enforcement point for the worktree lifecycle.
//
// Scope (deliberately narrow — P1+P2; the commit mapping is deferred):
//
//   git worktree list          -> giwt list          (bare form only)
//   git worktree remove <path> -> giwt remove <path> (single path, no flags)
//   git worktree prune         -> giwt cleanup       (bare form only)
//   git worktree add …         -> no rewrite; additionalContext nudge toward
//                                 `giwt new` / `giwt create` (the harness's
//                                 native `rewriteGitWorktreeAdd` already
//                                 handles clone-first materialization)
//   git merge <src>            -> giwt merge <src>   (in-worktree cwd only)
//   git rebase <target>        -> giwt rebase <target> (in-worktree cwd only)
//
// Never rewritten (config.yml bashInterceptor ask-gates and the
// harness-evasion-guard stay authoritative): push, stash, config, reset,
// clean, branch, commit (incl. --amend), checkout/switch/restore,
// cherry-pick/revert/tag/apply/am, `worktree move|lock|unlock|repair`,
// `merge --abort|--continue`, `rebase --abort|-i|…`.
//
// Shape contract per segment (reuse of harness-evasion-guard segmentation):
//   - `splitCommandSegments` slices the command; replacements are spliced back
//     at the segment's original offsets, so separators are preserved verbatim.
//   - A segment carrying chain/decoration prefixes (`cd`/`pushd`/`set`/noops —
//     `stripChainPrefix` changes it) is left for plain git; same for
//     `git -C …` / `git -c key=val …` / bare global-flag forms
//     (`stripGitOptionPrefix` changes the string), leading wrapper tokens
//     (sudo/env/nohup/nice/time/timeout), shell expansion (`$(…)`, backticks,
//     `$`, `*`, … — the whole command passes), and unquoted pipes.
//   - `rtk git <op>` is classified too: mapped ops rewrite to `giwt <op>`
//     (rtk wrapper dropped — giwt output is already compact); everything else
//     stays `rtk …`. Segments already headed by `giwt`/`rtk`/`omp` without a
//     git op are untouched (idempotence).
//   - Everything is gated on giwt being available for the cwd (config found by
//     walking up from cwd until a `giwt.toml`/`.giwt.toml`/`.tmp/giwt` root
//     resolves with an existing `tree/` container — `resolveGiwtConfig` alone
//     resolves from cwd only, which is wrong inside `tree/<name>` worktrees).
//
// Fail-open by construction: any unexpected shape, error, or unavailable giwt
// returns `undefined` and the command runs exactly as issued (interceptor +
// evasion-guard still apply).

import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { resolveGiwtConfig } from "../../extensions/util/giwt-resolve";
import {
  splitCommandSegments,
  stripChainPrefix,
  stripGitOptionPrefix,
} from "./harness-evasion-guard";

/** Where the reroute state came from; computed once per bash tool call. */
export interface GiwtRerouteContext {
  /** giwt config root found for the cwd (tree container exists). */
  available: boolean;
  /** Existing worktree container dir, or null when unavailable. */
  treeDir: string | null;
  /** cwd is strictly inside `treeDir` (i.e. a giwt-managed worktree). */
  inWorktree: boolean;
}

/** Pure classifier outcome for one command. */
export interface GiwtReroute {
  /** Fully rewritten command (separators preserved). */
  command?: string;
  /** Non-blocking guidance for the model (`additionalContext`). */
  nudge?: string;
}

export const WORKTREE_ADD_NUDGE =
  "worktree creation is giwt-managed in this repo: `giwt new <branch>` creates a branch + " +
  "worktree, `giwt create <branch>` attaches a worktree to an existing branch. Native " +
  "`git worktree add` bypasses the giwt ledger and the finalize gates.";

/** Git subcommands that must never be rewritten (ask-gates/guard own them). */
const NEVER_REWRITE_RE =
  /^git\s+(?:push|stash|config|reset|clean|branch|commit|checkout|switch|restore|cherry-pick|revert|tag|apply|am|format-patch)\b/;
/** Recovery forms (`merge --abort`, `rebase -i`, …) must stay plain git. */
const GIT_RECOVERY_RE = /^git\s+(?:merge|rebase)\s+--(?:abort|continue|quit|skip|edit-todo)\b/;

/** Leading wrapper tokens around git — conservative pass-through. */
const WRAPPER_HEAD_RE = /^\s*(?:sudo|nohup|env|nice|time|timeout)\b/;
/** Refuse shapes with shell expansion, mirroring bash-worktree-rewrite.ts. */
const SHELL_EXPANSION = /[$`~*[\]{}<>]/;
const RTK_HEAD_RE = /^rtk\s+/;
const GIT_HEAD_RE = /^git(?:\s|$)/;

/** Walk from cwd upward to the nearest giwt root whose tree container exists. */
export function resolveGiwtRerouteContext(cwd: string): GiwtRerouteContext {
  const target = resolve(cwd);
  let dir = target;
  for (;;) {
    const cfg = resolveGiwtConfig(dir);
    if (cfg.available && existsSync(cfg.treeDir)) {
      const rel = relative(cfg.treeDir, target);
      const inWorktree = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      return { available: true, treeDir: cfg.treeDir, inWorktree };
    }
    const parent = dirname(dir);
    if (parent === dir) return { available: false, treeDir: null, inWorktree: false };
    dir = parent;
  }
}

/**
 * Classify one segment. Returns a replacement for the whole segment
 * (env prefix preserved) or a nudge; `{}` means pass-through.
 */
function classifySegment(
  seg: string,
  ctx: GiwtRerouteContext,
): { replacement?: string; nudge?: string } {
  // Decoration prefixes (cd/pushd/set/noops) — leave for plain git + guard.
  if (stripChainPrefix(seg) !== seg) return {};
  if (SHELL_EXPANSION.test(seg)) return {};
  // Odd number of unescaped quotes → incomplete syntax; never rewrite.
  const unescaped = seg.replace(/\\./g, "");
  const quoteCount = (unescaped.match(/["']/g) ?? []).length;
  if (quoteCount % 2 !== 0) return {};

  // Leading NAME=value assignments: classify the tail, keep the prefix span.
  const stripped = withoutLeadingEnvAssignments(seg);
  const envPrefix = stripped === null ? "" : seg.slice(0, seg.length - stripped.length);
  let core = stripped ?? seg.trim();

  if (WRAPPER_HEAD_RE.test(core)) return {};

  // `rtk git <op>` is classified (mapped ops drop the rtk wrapper); bare
  // `rtk`/`omp`/`giwt` heads are already-rerouted shapes — untouched.
  const rtk = RTK_HEAD_RE.exec(core);
  if (rtk?.[0]) core = core.slice(rtk[0].length);
  else if (/^(?:omp|giwt)\b/.test(core)) return {};

  if (!GIT_HEAD_RE.test(core)) return {};
  // `git -C …`, `git -c key=val …`, bare globals (`--bare`, `-h`, …) → pass.
  if (stripGitOptionPrefix(core) !== core) return {};

  if (NEVER_REWRITE_RE.test(core) || GIT_RECOVERY_RE.test(core)) return {};

  let m = /^git\s+worktree\s+(list|remove|prune|add)\b(.*)$/.exec(core);
  if (m) {
    const op = m[1] ?? "";
    const rest = (m[2] ?? "").trim();
    if (op === "list" && rest === "") return { replacement: `${envPrefix}giwt list` };
    if (op === "prune" && rest === "") return { replacement: `${envPrefix}giwt cleanup` };
    if (op === "remove" && rest !== "" && isSingleShellWord(rest)) {
      return { replacement: `${envPrefix}giwt remove ${rest}` };
    }
    if (op === "add") return { nudge: WORKTREE_ADD_NUDGE };
    return {};
  }

  // P2: in-worktree merge/rebase onto a single named target.
  if (ctx.inWorktree) {
    m = /^git\s+merge\s+([^\s-]\S*)$/.exec(core);
    if (m?.[1]) return { replacement: `${envPrefix}giwt merge ${m[1]}` };
    m = /^git\s+rebase\s+([^\s-]\S*)$/.exec(core);
    if (m?.[1]) return { replacement: `${envPrefix}giwt rebase ${m[1]}` };
  }
  return {};
}

/**
 * Rewrite a full bash command when matched segments map to giwt. Returns
 * undefined for pass-through (unavailable giwt, no mapped shapes, refused
 * shapes). Pure — the default hook wires this into `tool_call`.
 */
export function giwtRerouteForCommand(
  command: string,
  ctx: GiwtRerouteContext,
): GiwtReroute | undefined {
  if (!ctx.available) return undefined;
  if (!command || command.startsWith("#")) return undefined;
  if (command.includes("$(") || command.includes("`")) return undefined;
  // Unquoted pipe → at least one stage reads piped stdin; keep plain git.
  const noEscapes = command.replace(/\\./g, "").replace(/"[^"]*"|'[^']*'/g, "");
  if (noEscapes.includes("|")) return undefined;

  const segments = splitCommandSegments(command);
  if (segments.length === 0) return undefined;

  let out = command;
  let nudge: string | undefined;
  let changed = false;
  let cursor = 0;
  for (const seg of segments) {
    const start = out.indexOf(seg, cursor);
    if (start < 0) return undefined;
    cursor = start + seg.length;
    const verdict = classifySegment(seg, ctx);
    if (verdict.replacement !== undefined) {
      out = out.slice(0, start) + verdict.replacement + out.slice(cursor);
      cursor = start + verdict.replacement.length;
      changed = true;
    } else if (verdict.nudge !== undefined && nudge === undefined) {
      nudge = verdict.nudge;
    }
  }
  if (nudge !== undefined) return { nudge };
  return changed ? { command: out } : undefined;
}

/**
 * Tool-call hook: rewrites bash commands toward giwt. Returns the harness
 * `ToolCallEventResult` shape — `{ input }` for rewrites (preserving every
 * other bash parameter), `{ additionalContext }` for the worktree-add nudge,
 * `undefined` to pass through. Never throws.
 */
export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    try {
      if (event.toolName !== "bash") return undefined;
      const command = event.input.command;
      if (typeof command !== "string" || command.trim() === "") return undefined;
      const ctx = resolveGiwtRerouteContext(process.cwd());
      if (!ctx.available) return undefined;
      const reroute = giwtRerouteForCommand(command, ctx);
      if (!reroute) return undefined;
      if (reroute.command !== undefined && reroute.command !== command) {
        return { input: { ...event.input, command: reroute.command } };
      }
      if (reroute.nudge !== undefined) return { additionalContext: reroute.nudge };
      return undefined;
    } catch {
      // Fail-open: the command runs as issued; interceptor + guard still apply.
      return undefined;
    }
  });
}

/**
 * True when `rest` is exactly one shell word (no unquoted whitespace).
 * Quotes are counted, not stripped — the arg is reused verbatim.
 */
function isSingleShellWord(rest: string): boolean {
  let q: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    else if (/\s/.test(ch ?? "")) return false;
  }
  return q === null;
}

/**
 * Local mirror of the harness `withoutLeadingEnvironmentAssignments`
 * (`src/tools/bash-interceptor.ts:74-95` — not exported to plugins): strips
 * leading `NAME=value` words. Returns the command tail, or null when there
 * are no assignments or the syntax is incomplete.
 */
function withoutLeadingEnvAssignments(command: string): string | null {
  let index = 0;
  let found = false;
  while (index < command.length) {
    while (command[index] === " " || command[index] === "\t") index++;
    const start = index;
    if (!/[A-Za-z_]/.test(command[index] ?? "")) break;
    let nameEnd = index + 1;
    while (/[A-Za-z0-9_]/.test(command[nameEnd] ?? "")) nameEnd++;
    if (command[nameEnd] !== "=") {
      return found ? command.slice(start).trimStart() : null;
    }
    const wordEnd = skipShellWord(command, nameEnd + 1);
    if (wordEnd === null) return null;
    found = true;
    index = wordEnd;
    if (index === command.length) return null;
  }
  if (!found) return null;
  const tail = command.slice(index).trimStart();
  return tail.length > 0 ? tail : null;
}

/** End of one shell word (quote/escape aware); null when unterminated. */
function skipShellWord(command: string, start: number): number | null {
  let q: string | null = null;
  let i = start;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (q) {
      if (ch === q) q = null;
    } else if (ch === "'" || ch === '"') {
      q = ch;
    } else if (/\s/.test(ch ?? "")) {
      return i;
    }
    i++;
  }
  return q === null ? i : null;
}
