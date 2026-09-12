/**
 * `/wt` in-repo placement — keep built-in worktrees inside the project root.
 *
 * The built-in `/wt` (and task isolation / `github pr_checkout`) resolve the
 * worktree base as `OMP_WORKTREE_DIR env ?? worktree.base setting ?? <profile
 * root>/wt`. The setting rejects relative paths, so per-repo placement can
 * only come from the env var. This module sets `OMP_WORKTREE_DIR` to
 * `<repoRoot>/<container>` (container `tree` or `.worktrees`, matching the
 * repo's convention — same targets the `/worktree` command uses) so worktrees
 * land where every policy layer (lean-ctx roots, write gate, guards) can see
 * them, instead of under `~/.omp/...`, which agent tooling cannot reach.
 *
 * Opt out: `PI_WORKTREE_IN_REPO=0` (or the plugin-wide
 * `PI_INTEGRATION_DISABLE=1`). An externally-set `OMP_WORKTREE_DIR` is never
 * overridden; only values this module set itself are updated or unset when
 * the session moves (e.g. after `/move`, refreshed on `session_start`/`input`
 * events). Exclusion of the container from `git status` is ensured
 * best-effort via `.git/info/exclude` — never `.gitignore`, no repo pollution.
 * Fail-open by construction: any fs/git surprise leaves the env untouched.
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Container dir names a repo may already use for worktrees (checked in order). */
const CONTAINERS = ["tree", ".worktrees"] as const;

export interface WorktreeBase {
  /** Repo root the worktrees belong to. */
  root: string;
  /** Container dir name (`tree` or `.worktrees`). */
  container: string;
  /** Absolute base dir for worktrees. */
  dir: string;
}

export type ApplyResult =
  | { kind: "set"; dir: string }
  | { kind: "unset" }
  | { kind: "skipped"; reason: "disabled" | "no-repo" | "user-preset" };

/** Index of a worktree container segment in a split path, or -1. */
function findAnchorIndex(parts: string[]): number {
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i];
    if (part === "tree" || part === ".worktrees") return i;
  }
  return -1;
}

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
 * Repo root for session cwd, derived from git metadata (not path segments):
 * the nearest `.git` owning the cwd resolves to its primary repo, so
 *  - cwd inside `<repo>/tree/<name>` (linked worktree) → base `<repo>/tree`
 *    (a second `/wt` creates a sibling under the parent repo, never a nested
 *    copy inside the worktree),
 *  - cwd inside a nested full checkout (clone, copied repo) → that checkout's
 *    own container (no leak into an outer repo's `tree/`).
 * Falls back to the legacy path-segment anchor only when worktree metadata
 * is unparseable.
 */
export function resolveWorktreeBase(cwd: string | undefined): WorktreeBase | null {
  const here = cwd ?? process.cwd();
  const gitRoot = findGitRoot(here);
  if (!gitRoot) return null;
  const primary = primaryRepoRoot(gitRoot);
  if (primary) {
    const container = CONTAINERS.find((c) => isDir(join(primary, c))) ?? "tree";
    return { root: primary, container, dir: join(primary, container) };
  }
  const parts = here.split("/").filter(Boolean);
  const at = findAnchorIndex(parts);
  if (at >= 0) {
    const root = `/${parts.slice(0, at).join("/")}`;
    const container = parts[at] ?? "tree";
    return { root, container, dir: join(root, container) };
  }
  const container = CONTAINERS.find((c) => isDir(join(gitRoot, c))) ?? "tree";
  return { root: gitRoot, container, dir: join(gitRoot, container) };
}

/**
 * Ensure `<container>/` is ignored via `<root>/.git/info/exclude` (never
 * `.gitignore` — local-only, zero repo pollution). Returns true when the file
 * was written, false when absent/skipped (e.g. `.git` is a worktree file, or
 * the exclusion already exists). Concurrent double-append is benign.
 */
export function ensureExcluded(root: string, container: string): boolean {
  const gitDir = join(root, ".git");
  if (!isDir(gitDir)) return false;
  const exclude = join(gitDir, "info", "exclude");
  try {
    const needle = `${container}/`;
    if (existsSync(exclude)) {
      for (const line of readFileSync(exclude, "utf8").split("\n")) {
        if (line.trim() === needle) return false;
      }
    }
    appendFileSync(exclude, `${needle}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
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
    ensureExcluded(base.root, base.container);
    return { kind: "set", dir: base.dir };
  };
  return apply;
}
