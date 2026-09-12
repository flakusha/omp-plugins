import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorktreeBaseApplier,
  ensureExcluded,
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

function makeRepo(withContainer?: "tree" | ".worktrees"): string {
  const root = tempDir("wtb-repo-");
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  if (withContainer) mkdirSync(join(root, withContainer));
  return root;
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
  test("defaults to tree/ and prefers an existing .worktrees dir", () => {
    const plain = makeRepo();
    expect(resolveWorktreeBase(plain)).toEqual({
      root: plain,
      container: "tree",
      dir: join(plain, "tree"),
    });
    const wt = makeRepo(".worktrees");
    expect(resolveWorktreeBase(wt)?.container).toBe(".worktrees");
  });

  test("anchors to the parent repo from inside tree/<name>", () => {
    const root = makeRepo();
    const inside = sub(root, "tree", "some-branch");
    expect(resolveWorktreeBase(inside)).toEqual({
      root,
      container: "tree",
      dir: join(root, "tree"),
    });
  });

  test("linked worktree inside the container resolves to the primary repo (recursion guard)", () => {
    const mainRoot = makeRepo("tree");
    const checkout = sub(mainRoot, "tree", "feature-x");
    linkWorktree(checkout, mainRoot, "feature-x");
    const expected = { root: mainRoot, container: "tree", dir: join(mainRoot, "tree") };
    expect(resolveWorktreeBase(checkout)).toEqual(expected);
    expect(resolveWorktreeBase(sub(checkout, "deep", "deeper"))).toEqual(expected);
    expect(primaryRepoRoot(checkout)).toBe(mainRoot);
  });

  test("nested full checkout owns its own base (no leak into the outer container)", () => {
    const outer = makeRepo("tree");
    const inner = sub(outer, "tree", "inner-clone");
    mkdirSync(join(inner, ".git"), { recursive: true });
    expect(resolveWorktreeBase(inner)).toEqual({
      root: inner,
      container: "tree",
      dir: join(inner, "tree"),
    });
  });

  test("returns null when cwd is not in a repo", () => {
    expect(resolveWorktreeBase(tempDir("wtb-norepo2-"))).toBeNull();
  });
});

describe("ensureExcluded", () => {
  test("appends once and is idempotent", () => {
    const root = makeRepo();
    expect(ensureExcluded(root, "tree")).toBe(true);
    expect(ensureExcluded(root, "tree")).toBe(false);
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf8");
    expect(exclude.match(/^tree\/$/gm)?.length).toBe(1);
  });

  test("skips when .git is a worktree file, not a dir", () => {
    const root = tempDir("wtb-wtfile-");
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere\n");
    expect(ensureExcluded(root, "tree")).toBe(false);
  });
});

describe("createWorktreeBaseApplier", () => {
  test("sets the env var and reuses its own value idempotently", () => {
    const root = makeRepo();
    const env: Record<string, string | undefined> = {};
    const applier = createWorktreeBaseApplier();
    expect(applier(root, env)).toEqual({ kind: "set", dir: join(root, "tree") });
    expect(applier(root, env)).toEqual({ kind: "set", dir: join(root, "tree") });
    expect(env.OMP_WORKTREE_DIR).toBe(join(root, "tree"));
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
    expect(applier(b, env)).toEqual({ kind: "set", dir: join(b, "tree") });
    expect(env.OMP_WORKTREE_DIR).toBe(join(b, "tree"));
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

  test("excludes the container when it sets the env var", () => {
    const root = makeRepo();
    createWorktreeBaseApplier()(root, {});
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("tree/");
  });
});
