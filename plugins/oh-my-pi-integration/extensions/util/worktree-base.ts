/**
 * `/wt` out-of-repo placement — keep built-in worktrees OUTSIDE the repo, in
 * a sibling folder of the repo root.
 *
 * The built-in `/wt` (and task isolation / `github pr_checkout`) resolve the
 * worktree base as `OMP_WORKTREE_DIR env ?? worktree.base setting ?? <profile
 * root>/wt`. The setting rejects relative paths, so per-repo placement can
 * only come from the env var. This module sets `OMP_WORKTREE_DIR` to
 * `<repoParent>/<repoName>-worktrees` — a sibling directory of the repo —
 * because keeping the container INSIDE the repo (`<repo>/tree/`) proved
 * unfixable: the clone-first /wt backend copies the full working tree
 * (`keepChanges`), so an in-repo container made every worktree contain
 * copies of prior worktrees, and sessions inside `<repo>/<container>/…`
 * re-created worktrees recursively. Outside the repo the copies can never
 * include the container, breaking the loop structurally; the sibling
 * location also removes `.git/info/exclude` hacks and git-status pollution.
 *
 * Opt out: `PI_WORKTREE_IN_REPO=0` (historical name) or the plugin-wide
 * `PI_INTEGRATION_DISABLE=1`. An externally-set `OMP_WORKTREE_DIR` is never
 * overridden; only values this module set itself are updated or unset when
 * the session moves (e.g. after `/move`, refreshed on `session_start`/`input`
 * events). Fail-open by construction: any fs surprise leaves the env
 * untouched.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export interface WorktreeBase {
  /** Primary repo root the worktrees belong to. */
  root: string;
  /** Sibling container dir name (`<repoName>-worktrees`). */
  container: string;
  /** Absolute base dir for worktrees, OUTSIDE the repo. */
  dir: string;
}

export type ApplyResult =
  | { kind: "set"; dir: string }
  | { kind: "unset" }
  | { kind: "skipped"; reason: "disabled" | "no-repo" | "user-preset" };

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Nearest ancestor of `cwd` that is a git repo (`.git` dir or worktree `.git`
 * file). Pure fs walk, no subprocess.
 */
export function findGitRoot(cwd: string | undefined): string | null {
  const here = cwd ?? process.cwd();
  const parts = here.split("/").filter(Boolean);
  // Bottom-up: the NEAREST enclosing .git owns the checkout. A top-down walk
  // returns an outer repo for nested checkouts (clones, copied worktree
  // copies), which mis-routed their worktrees into the outer repo's
  // container — the recursion engine behind nested /wt copies.
  for (let i = parts.length; i >= 1; i--) {
    const cur = `/${parts.slice(0, i).join("/")}`;
    if (existsSync(join(cur, ".git"))) return cur;
  }
  return null;
}

/**
 * Primary repo root that owns `gitRoot`: a full checkout (`.git` dir) owns
 * itself; a linked worktree (`.git` file with `gitdir: <path>`) resolves
 * through the worktree's `commondir` to the shared git dir's parent repo, so
 * worktrees created from inside a worktree become siblings of their origin
 * instead of nesting inside it. Null when the metadata cannot be parsed
 * (callers fall back to path-segment heuristics).
 */
export function primaryRepoRoot(gitRoot: string): string | null {
  const dotGit = join(gitRoot, ".git");
  if (isDir(dotGit)) return gitRoot;
  let gitdir: string;
  try {
    const m = /^gitdir:\s*(.+?)\s*$/.exec(readFileSync(dotGit, "utf8"));
    if (!m?.[1]) return null;
    gitdir = isAbsolute(m[1]) ? m[1] : join(gitRoot, m[1]);
  } catch {
    return null;
  }
  try {
    const common = readFileSync(join(gitdir, "commondir"), "utf8").trim();
    return dirname(resolve(join(gitdir, common)));
  } catch {
    return null;
  }
}

/**
 * Worktree base for session cwd, derived from git metadata (not path
 * segments): the nearest `.git` owning the cwd resolves to its primary repo,
 * and the base is that repo's OUT-OF-REPO sibling container
 * `<repoParent>/<repoName>-worktrees`. Consequences:
 *  - cwd inside a linked worktree (e.g. `<repo>/tree/<name>`) → base beside
 *    the PRIMARY repo — a second `/wt` creates a sibling of the origin,
 *    never a nested copy;
 *  - cwd inside a nested full checkout (clone, copied repo) → that
 *    checkout's own sibling (no leak into an outer repo);
 *  - the base can never sit inside a worktree, so the clone-first backend's
 *    full-tree copies can never contain the container — recursion is
 *    structurally impossible.
 */
export function resolveWorktreeBase(cwd: string | undefined): WorktreeBase | null {
  const here = cwd ?? process.cwd();
  const gitRoot = findGitRoot(here);
  if (!gitRoot) return null;
  const primary = primaryRepoRoot(gitRoot);
  if (!primary) return null;
  const parent = dirname(primary);
  if (parent === primary) return null; // repo rooted at "/" has no sibling
  const container = `${basename(primary)}-worktrees`;
  return { root: primary, container, dir: join(parent, container) };
}

export type WorktreeBaseApplier = (
  cwd: string | undefined,
  env?: Record<string, string | undefined>,
) => ApplyResult;

/**
 * Stateful applier: tracks values it set itself so it can move them between
 * repos (`/move`) or unset them outside any repo, while a user-provided
 * `OMP_WORKTREE_DIR` is never touched.
 */
export function createWorktreeBaseApplier(): WorktreeBaseApplier {
  let setByUs = false;
  const apply = (
    cwd: string | undefined,
    env: Record<string, string | undefined> = process.env,
  ): ApplyResult => {
    if (env.PI_INTEGRATION_DISABLE === "1" || env.PI_WORKTREE_IN_REPO === "0") {
      return { kind: "skipped", reason: "disabled" };
    }
    const base = resolveWorktreeBase(cwd);
    if (!base) {
      if (setByUs) {
        delete env.OMP_WORKTREE_DIR;
        setByUs = false;
        return { kind: "unset" };
      }
      return { kind: "skipped", reason: "no-repo" };
    }
    if (env.OMP_WORKTREE_DIR !== undefined && !setByUs) {
      return { kind: "skipped", reason: "user-preset" };
    }
    if (env.OMP_WORKTREE_DIR === base.dir && setByUs) {
      return { kind: "set", dir: base.dir };
    }
    env.OMP_WORKTREE_DIR = base.dir;
    setByUs = true;
    return { kind: "set", dir: base.dir };
  };
  return apply;
}
