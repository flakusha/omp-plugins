import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorktreeBaseApplier,
  ensureExcluded,
  findGitRoot,
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
