/**
 * `/find-work` merge-queue pure parsers: `git branch` format lines, rev-list
 * counts, symbolic-ref merge base, worktree porcelain blocks, and short
 * status counts. No I/O — unit tested without subprocesses.
 */

export interface MergeBranch {
  name: string;
  sha: string;
  subject: string;
  date: string;
}

/**
 * Parse `git branch --format='%(refname:short)|%(objectname:short)|%(subject)|%(committerdate:short)'`.
 * Subjects may contain `|` — and branch names may too (legal, if perverse) —
 * so the short SHA (always hex) anchors the split: everything before the
 * first hex segment is the name, everything between it and the trailing
 * date is the subject.
 */
export function parseBranchLines(stdout: string): MergeBranch[] {
  const out: MergeBranch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const shaAt = parts.findIndex((p, i) => i > 0 && /^[0-9a-f]{4,40}$/.test(p.trim()));
    if (shaAt < 0) continue;
    const name = parts.slice(0, shaAt).join("|").trim();
    const sha = (parts[shaAt] ?? "").trim();
    const date = (parts[parts.length - 1] ?? "").trim();
    const subject = parts
      .slice(shaAt + 1, -1)
      .join("|")
      .trim();
    if (!name || !sha) continue;
    out.push({ name, sha, subject, date });
  }
  return out;
}

/** Parse `git rev-list --left-right --count <base>...<branch>` ("behind ahead"). */
export function parseRevCounts(stdout: string): { ahead: number; behind: number } | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(stdout.trim());
  if (!m?.[1] || !m?.[2]) return null;
  return { behind: Number(m[1]), ahead: Number(m[2]) };
}

/** Parse `git symbolic-ref refs/remotes/origin/HEAD` ("refs/remotes/origin/dev"). */
export function parseMergeBase(stdout: string): string | null {
  const m = /refs\/remotes\/[^/]+\/(.+?)\s*$/.exec(stdout.trim());
  const base = m?.[1]?.trim();
  return base ? base : null;
}

export interface MergeWorktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  /** Prune reason when git flags the entry stale; null when healthy. */
  prunable: string | null;
}

/** Apply one porcelain line to the in-progress worktree entry. */
function applyPorcelainLine(cur: MergeWorktree, line: string): void {
  if (line.startsWith("HEAD ")) {
    cur.head = line.slice("HEAD ".length).trim();
  } else if (line.startsWith("branch ")) {
    const ref = line.slice("branch ".length).trim();
    cur.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  } else if (line === "bare") {
    cur.bare = true;
  } else if (line === "detached") {
    cur.detached = true;
  } else if (line === "prunable" || line.startsWith("prunable ")) {
    cur.prunable = line.slice("prunable".length).trim() || "stale metadata";
  }
}

/** Parse `git worktree list --porcelain` blocks (blank-line separated). */
export function parseWorktreePorcelain(stdout: string): MergeWorktree[] {
  const out: MergeWorktree[] = [];
  let cur: MergeWorktree | null = null;
  const flush = () => {
    if (cur && cur.path) out.push(cur);
    cur = null;
  };
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      cur = {
        path: line.slice("worktree ".length).trim(),
        head: "",
        branch: null,
        bare: false,
        detached: false,
        prunable: null,
      };
    } else if (cur) {
      applyPorcelainLine(cur, line);
    }
  }
  flush();
  return out;
}

export interface DirtyStat {
  modified: number;
  untracked: number;
  total: number;
}

/** Parse `git status --short`: `??` counts untracked, anything else modified. */
export function parseStatusShort(stdout: string): DirtyStat {
  let modified = 0;
  let untracked = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 2) continue;
    if (line.startsWith("??")) untracked += 1;
    else modified += 1;
  }
  return { modified, untracked, total: modified + untracked };
}
