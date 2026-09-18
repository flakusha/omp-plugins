/**
 * `/find-work` merge-queue scan: unmerged-branch and dirty/prunable-worktree
 * tickets resolved through live git calls against a detected merge base.
 */

import { resolveGiwtConfig } from "../../util/giwt-config";
import { SOURCE_EXEC_TIMEOUT_MS } from "./keywords";
import {
  type DirtyStat,
  parseBranchLines,
  parseMergeBase,
  parseRevCounts,
  parseStatusShort,
  parseWorktreePorcelain,
} from "./merge-parse";
import { type ExecLike, execTool } from "./tool-exec";
import type { WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// Branches/worktrees merge queue
// ---------------------------------------------------------------------------

/** Bounds: branches probed for ahead/behind, tickets surfaced. */
export const MERGE_MAX_BRANCHES = 12;
export const MERGE_MAX_TICKETS = 15;

/** Resolve the merge base: origin HEAD, then dev/main/master by existence. */
async function resolveMergeBase(pi: ExecLike, root: string): Promise<string> {
  try {
    const out = await execTool(
      pi,
      "git",
      ["-C", root, "symbolic-ref", "refs/remotes/origin/HEAD"],
      SOURCE_EXEC_TIMEOUT_MS,
    );
    const base = parseMergeBase(out);
    if (base) return base;
  } catch {
    /* fall through to local branch probes */
  }
  for (const candidate of ["dev", "main", "master"]) {
    try {
      const out = await execTool(
        pi,
        "git",
        ["-C", root, "branch", "--list", candidate],
        SOURCE_EXEC_TIMEOUT_MS,
      );
      if (out.split(/\r?\n/).some((l) => l.replace(/^[* ]+/, "").trim() === candidate)) {
        return candidate;
      }
    } catch {}
  }
  throw new Error("no merge base resolvable");
}

/** Unmerged-branch tickets: ahead/behind counts against the base. */
async function unmergedBranchTickets(
  pi: ExecLike,
  root: string,
  base: string,
): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    "git",
    [
      "-C",
      root,
      "branch",
      "--format=%(refname:short)|%(objectname:short)|%(subject)|%(committerdate:short)",
      "--no-merged",
      base,
    ],
    SOURCE_EXEC_TIMEOUT_MS,
  );
  const protectedBranches = new Set(resolveGiwtConfig(root).protectedBranches);
  const branches = parseBranchLines(out)
    .filter((b) => b.name !== base && !protectedBranches.has(b.name))
    .slice(0, MERGE_MAX_BRANCHES);
  const tickets: WorkTicket[] = [];
  for (const branch of branches) {
    let counts: { ahead: number; behind: number } | null = null;
    try {
      const raw = await execTool(
        pi,
        "git",
        ["-C", root, "rev-list", "--left-right", "--count", `${base}...${branch.name}`],
        SOURCE_EXEC_TIMEOUT_MS,
      );
      counts = parseRevCounts(raw);
    } catch {
      continue; // branch vanished mid-scan; skip it
    }
    if (!counts) continue;
    const stale = counts.behind > 0 ? `, ${counts.behind} behind` : "";
    tickets.push({
      id: branch.name,
      title: `merge ${branch.name} → ${base}: ${counts.ahead} ahead${stale}${branch.subject ? ` — ${branch.subject}` : ""}`,
      source: "merges",
      kind: "task",
      priority: "P2",
      domain: "branches",
    });
  }
  return tickets;
}

/** Dirty-worktree tickets: uncommitted changes per checkout. */
async function worktreeDirtyTickets(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    "git",
    ["-C", root, "worktree", "list", "--porcelain"],
    SOURCE_EXEC_TIMEOUT_MS,
  );
  const worktrees = parseWorktreePorcelain(out)
    .filter((w) => !w.bare)
    .slice(0, MERGE_MAX_BRANCHES);
  const tickets: WorkTicket[] = [];
  for (const wt of worktrees) {
    const name = wt.branch ?? wt.path.split("/").pop() ?? wt.path;
    const rel = wt.path.startsWith(`${root}/`) ? wt.path.slice(root.length + 1) : wt.path;
    if (wt.prunable) {
      tickets.push({
        id: `WT-${name}`,
        title: `prunable worktree ${rel} (${wt.prunable}) — git worktree prune to clean up`,
        source: "merges",
        kind: "task",
        priority: "P3",
        domain: "worktrees",
      });
      continue;
    }
    let stat: DirtyStat;
    try {
      const raw = await execTool(
        pi,
        "git",
        ["-C", wt.path, "status", "--short"],
        SOURCE_EXEC_TIMEOUT_MS,
      );
      stat = parseStatusShort(raw);
    } catch {
      continue; // worktree metadata broken; `git worktree repair` territory
    }
    if (stat.total === 0) continue;
    const bits = [
      stat.modified > 0 ? `${stat.modified} modified` : null,
      stat.untracked > 0 ? `${stat.untracked} untracked` : null,
    ]
      .filter(Boolean)
      .join(", ");
    tickets.push({
      id: `WT-${name}`,
      title: `uncommitted changes in ${rel} (${bits})${wt.branch ? ` — ${wt.branch}` : ""}`,
      source: "merges",
      kind: "task",
      priority: "P1",
      domain: "worktrees",
    });
  }
  return tickets;
}

/**
 * Merge-queue tickets: unmerged branches (ahead/behind vs base), worktrees
 * holding uncommitted changes, and prunable (stale) worktree entries.
 * Throws when git is unusable — the caller turns that into a warning.
 */
export async function fetchMergeTickets(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const base = await resolveMergeBase(pi, root);
  const branches = await unmergedBranchTickets(pi, root, base);
  const worktrees = await worktreeDirtyTickets(pi, root);
  return [...worktrees, ...branches].slice(0, MERGE_MAX_TICKETS);
}
