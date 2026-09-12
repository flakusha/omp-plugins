import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  createWorktreeBaseApplier,
  findGitRoot,
  primaryRepoRoot,
  resolveWorktreeBase,
} from "../util/worktree-base";

// Resource contract: every test owns a private mkdtemp dir (listed in
// tempDirs) removed in afterEach; appliers are per-test instances, so no
// module state is shared across tests or files.
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeRepo(): string {
  const root = tempDir("wtb-repo-");
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return root;
}

/** Expected out-of-repo sibling base for a repo root. */
function sibling(repo: string): string {
  return join(dirname(repo), `${basename(repo)}-worktrees`);
}

function sub(root: string, ...parts: string[]): string {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Wire `checkout` up as a linked worktree named `name` of `mainRoot`. */
function linkWorktree(checkout: string, mainRoot: string, name: string): void {
  const gitdir = join(mainRoot, ".git", "worktrees", name);
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  writeFileSync(join(checkout, ".git"), `gitdir: ${gitdir}\n`);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("findGitRoot", () => {
  test("walks up to the repo root from deep subdirs", () => {
    const root = makeRepo();
    expect(findGitRoot(sub(root, "a", "b"))).toBe(root);
  });

  test("treats a .git file (worktree checkout) as a root", () => {
    const root = tempDir("wtb-file-");
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere\n");
    expect(findGitRoot(root)).toBe(root);
  });

  test("prefers the nearest nested repo over an outer repo", () => {
    const outer = makeRepo();
    const inner = sub(outer, "vendor", "pkg");
    mkdirSync(join(inner, ".git"));
    expect(findGitRoot(sub(inner, "src"))).toBe(inner);
  });

  test("returns null outside any repo", () => {
    expect(findGitRoot(tempDir("wtb-norepo-"))).toBeNull();
  });
});

describe("resolveWorktreeBase", () => {
  test("defaults to the out-of-repo sibling dir of the repo", () => {
    const plain = makeRepo();
    expect(resolveWorktreeBase(plain)).toEqual({
      root: plain,
      container: `${basename(plain)}-worktrees`,
      dir: sibling(plain),
    });
  });

  test("links a legacy in-repo container to the primary repo's sibling (recursion guard)", () => {
    const mainRoot = makeRepo();
    const checkout = sub(mainRoot, "tree", "feature-x");
    linkWorktree(checkout, mainRoot, "feature-x");
    const expected = {
      root: mainRoot,
      container: `${basename(mainRoot)}-worktrees`,
      dir: sibling(mainRoot),
    };
    expect(resolveWorktreeBase(checkout)).toEqual(expected);
    expect(resolveWorktreeBase(sub(checkout, "deep", "deeper"))).toEqual(expected);
    expect(primaryRepoRoot(checkout)).toBe(mainRoot);
  });

  test("nested full checkout owns its own sibling (no leak into the outer repo)", () => {
    const outer = makeRepo();
    const inner = sub(outer, "vendor", "inner-clone");
    mkdirSync(join(inner, ".git"), { recursive: true });
    expect(resolveWorktreeBase(inner)).toEqual({
      root: inner,
      container: `${basename(inner)}-worktrees`,
      dir: sibling(inner),
    });
  });

  test("returns null when cwd is not in a repo", () => {
    expect(resolveWorktreeBase(tempDir("wtb-norepo2-"))).toBeNull();
  });
});

describe("createWorktreeBaseApplier", () => {
  test("sets the env var and reuses its own value idempotently", () => {
    const root = makeRepo();
    const env: Record<string, string | undefined> = {};
    const applier = createWorktreeBaseApplier();
    expect(applier(root, env)).toEqual({ kind: "set", dir: sibling(root) });
    expect(applier(root, env)).toEqual({ kind: "set", dir: sibling(root) });
    expect(env.OMP_WORKTREE_DIR).toBe(sibling(root));
  });

  test("never overrides a user-preset value", () => {
    const root = makeRepo();
    const env: Record<string, string | undefined> = { OMP_WORKTREE_DIR: "/somewhere" };
    expect(createWorktreeBaseApplier()(root, env)).toEqual({
      kind: "skipped",
      reason: "user-preset",
    });
    expect(env.OMP_WORKTREE_DIR).toBe("/somewhere");
  });

  test("re-points its own value after /move and unsets outside repos", () => {
    const a = makeRepo();
    const b = makeRepo();
    const env: Record<string, string | undefined> = {};
    const applier = createWorktreeBaseApplier();
    applier(a, env);
    expect(applier(b, env)).toEqual({ kind: "set", dir: sibling(b) });
    expect(env.OMP_WORKTREE_DIR).toBe(sibling(b));
    expect(applier(tempDir("wtb-norepo3-"), env)).toEqual({ kind: "unset" });
    expect(env.OMP_WORKTREE_DIR).toBeUndefined();
  });

  test("kill switches disable it without touching env", () => {
    const root = makeRepo();
    for (const key of ["PI_INTEGRATION_DISABLE", "PI_WORKTREE_IN_REPO"]) {
      const env: Record<string, string | undefined> = {
        [key]: key === "PI_INTEGRATION_DISABLE" ? "1" : "0",
      };
      expect(createWorktreeBaseApplier()(root, env)).toEqual({
        kind: "skipped",
        reason: "disabled",
      });
      expect(env.OMP_WORKTREE_DIR).toBeUndefined();
    }
  });
});
