/**
 * `/find-work` patch-review source: the repo's own uncommitted patch
 * (working-tree changes vs HEAD, plus untracked files) surfaces as ONE review
 * work item focused on application performance and bughunting — the roster's
 * "review current changes" lane. Two cheap read-only git calls; counts only,
 * never a diff body.
 */

import { SOURCE_EXEC_TIMEOUT_MS } from "./keywords";
import type { ExecLike } from "./tool-exec";
import type { WorkTicket } from "./types";

/** porcelain v1 `## <branch>…origin/<branch>` header → branch name. */
export const PATCH_BRANCH_RE = /^##\s+(\S+?)(?:\.\.\.|\s|$)/;

/** `git diff --shortstat` component counts (each part optional). */
const SHORTSTAT_FILES_RE = /(\d+)\s+files? changed/;
const SHORTSTAT_INS_RE = /(\d+)\s+insertions?\(\+\)/;
const SHORTSTAT_DEL_RE = /(\d+)\s+deletions?\(-\)/;

export interface PatchCounts {
  branch: string | null;
  /** Tracked + untracked change entries in porcelain output. */
  changed: number;
  untracked: number;
}

/** Parse `git status --porcelain=v1 -b` output. */
export function parsePatchCounts(statusOut: string): PatchCounts {
  let branch: string | null = null;
  let changed = 0;
  let untracked = 0;
  for (const line of statusOut.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("##")) {
      branch = PATCH_BRANCH_RE.exec(line)?.[1] ?? null;
      continue;
    }
    changed++;
    if (line.startsWith("??")) untracked++;
  }
  return { branch, changed, untracked };
}

export interface PatchStat {
  files: number;
  insertions: number;
  deletions: number;
}

/** Parse `git diff --shortstat` output (` 3 files changed, 10 insertions(+), 2 deletions(-)`). */
export function parseShortstat(out: string): PatchStat {
  return {
    files: Number(SHORTSTAT_FILES_RE.exec(out)?.[1] ?? 0),
    insertions: Number(SHORTSTAT_INS_RE.exec(out)?.[1] ?? 0),
    deletions: Number(SHORTSTAT_DEL_RE.exec(out)?.[1] ?? 0),
  };
}

/**
 * The review ticket, or null on a clean tree (nothing changed → nothing to
 * review). Kind task, P2, domain `review` — a deliberate, bounded pass over
 * the current patch for performance issues and bugs, not a blocker.
 */
export function buildPatchTicket(counts: PatchCounts, stat: PatchStat): WorkTicket | null {
  if (counts.changed === 0) return null;
  const parts = [`${counts.changed} file${counts.changed === 1 ? "" : "s"} changed`];
  if (stat.insertions > 0 || stat.deletions > 0)
    parts.push(`+${stat.insertions}/-${stat.deletions}`);
  if (counts.untracked > 0) parts.push(`${counts.untracked} untracked`);
  return {
    id: "PATCH",
    title: `Review current patch (${parts.join(", ")}) — performance & bughunting pass`,
    source: "patch",
    kind: "task",
    priority: "P2",
    domain: "review",
  };
}

/** Live source: status + shortstat against the session cwd's repo. */
export async function fetchPatchReviewTickets(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const status = await pi.exec("git", ["-C", root, "status", "--porcelain=v1", "-b"], {
    timeout: SOURCE_EXEC_TIMEOUT_MS,
  });
  const diff = await pi.exec("git", ["-C", root, "diff", "--shortstat"], {
    timeout: SOURCE_EXEC_TIMEOUT_MS,
  });
  const ticket = buildPatchTicket(
    parsePatchCounts(status.stdout ?? ""),
    parseShortstat(diff.stdout ?? ""),
  );
  return ticket ? [ticket] : [];
}
