import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import defaultHook, {
  type GiwtRerouteContext,
  giwtRerouteForCommand,
  resolveGiwtRerouteContext,
  WORKTREE_ADD_NUDGE,
} from "../git-giwt-reroute";

// Resource contract: every test owns a private mkdtempSync root (unique per
// call) holding its giwt.toml + tree/ fixture, released in afterEach —
// parallel-safe under `bun test` file/worker parallelism. No chdir anywhere:
// P2 (in-worktree) cases go through the pure `giwtRerouteForCommand` with a
// synthetic context; the handler-level test only exercises shapes that do not
// depend on cwd being a worktree. Walk-up from a /tmp fixture terminates at
// unavailable — /tmp and / carry no giwt config.

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "giwt-reroute-"));
  tempDirs.push(dir);
  return dir;
}

/** giwt repo root fixture: giwt.toml at root + an existing tree/ container. */
function makeGiwtRoot(): { root: string; worktree: string } {
  const root = makeTempRoot();
  writeFileSync(join(root, "giwt.toml"), '[branches]\nroot = "master"\n');
  const worktree = join(root, "tree", "wt-a");
  mkdirSync(worktree, { recursive: true });
  return { root, worktree };
}

const UNAVAILABLE: GiwtRerouteContext = {
  available: false,
  treeDir: null,
  inWorktree: false,
};
const ROOT_CTX: GiwtRerouteContext = {
  available: true,
  treeDir: "/repo/tree",
  inWorktree: false,
};
const WORKTREE_CTX: GiwtRerouteContext = {
  available: true,
  treeDir: "/repo/tree",
  inWorktree: true,
};

describe("resolveGiwtRerouteContext", () => {
  test("finds the repo root and flags a tree/ worktree cwd", () => {
    const { root, worktree } = makeGiwtRoot();
    const rootCtx = resolveGiwtRerouteContext(root);
    expect(rootCtx.available).toBe(true);
    expect(rootCtx.treeDir).toBe(join(root, "tree"));
    expect(rootCtx.inWorktree).toBe(false);

    const wtCtx = resolveGiwtRerouteContext(worktree);
    expect(wtCtx.available).toBe(true);
    expect(wtCtx.inWorktree).toBe(true);
  });

  test("a cwd outside tree/ is not a worktree", () => {
    const { root } = makeGiwtRoot();
    const other = join(root, "other");
    mkdirSync(other);
    const ctx = resolveGiwtRerouteContext(other);
    expect(ctx.available).toBe(true);
    expect(ctx.inWorktree).toBe(false);
  });

  test("no giwt config anywhere → unavailable", () => {
    const dir = makeTempRoot();
    expect(resolveGiwtRerouteContext(dir).available).toBe(false);
  });

  test("walks past a worktree checkout whose own tree/ is missing", () => {
    // Realistic worktree: the branch carries giwt.toml but has no tree/ of
    // its own — the walk must land on the parent root's tree container.
    const root = makeTempRoot();
    writeFileSync(join(root, "giwt.toml"), "");
    mkdirSync(join(root, "tree"));
    const wt = join(root, "tree", "wt-b");
    mkdirSync(wt);
    writeFileSync(join(wt, "giwt.toml"), "");
    const ctx = resolveGiwtRerouteContext(wt);
    expect(ctx.available).toBe(true);
    expect(ctx.treeDir).toBe(join(root, "tree"));
    expect(ctx.inWorktree).toBe(true);
  });

  test("the repo checkout itself resolves available (regression: live repo)", () => {
    // This repo has giwt.toml + tree/ at its root; bun test runs from there.
    expect(resolveGiwtRerouteContext(process.cwd()).available).toBe(true);
  });
});

describe("giwtRerouteForCommand — worktree P1 shapes", () => {
  test("bare list/prune rewrite; flagged forms pass through", () => {
    expect(giwtRerouteForCommand("git worktree list", ROOT_CTX)).toEqual({
      command: "giwt list",
    });
    expect(giwtRerouteForCommand("git worktree list --porcelain", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree list -v", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree prune", ROOT_CTX)).toEqual({
      command: "giwt cleanup",
    });
    expect(giwtRerouteForCommand("git worktree prune --expire 1.day", ROOT_CTX)).toBeUndefined();
  });

  test("remove rewrites a single path (quoted ok); flags/multi-args pass", () => {
    expect(giwtRerouteForCommand("git worktree remove tree/wt-a", ROOT_CTX)).toEqual({
      command: "giwt remove tree/wt-a",
    });
    expect(giwtRerouteForCommand('git worktree remove "/tmp/a b"', ROOT_CTX)).toEqual({
      command: 'giwt remove "/tmp/a b"',
    });
    expect(giwtRerouteForCommand("git worktree remove --force x", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree remove a b", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree remove", ROOT_CTX)).toBeUndefined();
  });

  test("worktree add nudges toward giwt new/create without rewriting", () => {
    expect(giwtRerouteForCommand("git worktree add ../feat-wt", ROOT_CTX)).toEqual({
      nudge: WORKTREE_ADD_NUDGE,
    });
    expect(giwtRerouteForCommand("git worktree add -b feat ../feat-wt", ROOT_CTX)).toEqual({
      nudge: WORKTREE_ADD_NUDGE,
    });
    const reroute = giwtRerouteForCommand("git worktree add ../feat-wt", ROOT_CTX);
    expect(reroute?.command).toBeUndefined();
  });

  test("unclassified worktree ops stay plain git", () => {
    expect(giwtRerouteForCommand("git worktree move a b", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree lock x", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree repair", ROOT_CTX)).toBeUndefined();
  });
});

describe("giwtRerouteForCommand — never rewritten", () => {
  test("ask-gated and destructive ops always pass through", () => {
    expect(giwtRerouteForCommand("git push origin main", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git stash", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git stash push -- src/x.ts", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git config set user.name x", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git reset --hard HEAD~1", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git clean -fd", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git branch -D feat", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand('git commit -m "x"', WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git commit --amend", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git checkout -- .", WORKTREE_CTX)).toBeUndefined();
  });

  test("merge/rebase recovery and flag forms stay plain git", () => {
    expect(giwtRerouteForCommand("git merge --abort", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git merge --continue", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git rebase --abort", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git rebase -i master", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git merge --no-ff feat", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git merge master extra", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git merge", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git rebase", WORKTREE_CTX)).toBeUndefined();
  });

  test("read-only git stays untouched", () => {
    expect(giwtRerouteForCommand("git status", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git log --oneline -5", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git diff HEAD~1", ROOT_CTX)).toBeUndefined();
  });
});

describe("giwtRerouteForCommand — in-worktree merge/rebase (P2)", () => {
  test("single named target rewrites inside a worktree", () => {
    expect(giwtRerouteForCommand("git merge master", WORKTREE_CTX)).toEqual({
      command: "giwt merge master",
    });
    expect(giwtRerouteForCommand("git merge origin/feat", WORKTREE_CTX)).toEqual({
      command: "giwt merge origin/feat",
    });
    expect(giwtRerouteForCommand("git rebase master", WORKTREE_CTX)).toEqual({
      command: "giwt rebase master",
    });
    expect(giwtRerouteForCommand("git rebase origin/master", WORKTREE_CTX)).toEqual({
      command: "giwt rebase origin/master",
    });
  });

  test("outside a worktree merge/rebase never rewrite", () => {
    expect(giwtRerouteForCommand("git merge master", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("git rebase master", ROOT_CTX)).toBeUndefined();
  });
});

describe("giwtRerouteForCommand — rtk and idempotence", () => {
  test("rtk-prefixed mapped ops rewrite to giwt (wrapper dropped)", () => {
    expect(giwtRerouteForCommand("rtk git worktree list", ROOT_CTX)).toEqual({
      command: "giwt list",
    });
    expect(giwtRerouteForCommand("rtk git merge master", WORKTREE_CTX)).toEqual({
      command: "giwt merge master",
    });
    expect(giwtRerouteForCommand("rtk git push origin main", WORKTREE_CTX)).toBeUndefined();
  });

  test("already-rerouted shapes are untouched", () => {
    expect(giwtRerouteForCommand("giwt list", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("giwt merge master", WORKTREE_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("rtk ls -la", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("omp worktree add ../x", ROOT_CTX)).toBeUndefined();
  });
});

describe("giwtRerouteForCommand — refused shapes", () => {
  test("git global-flag forms pass through", () => {
    expect(giwtRerouteForCommand("git -C /repo worktree list", ROOT_CTX)).toBeUndefined();
    expect(
      giwtRerouteForCommand("git -c core.hooksPath=/x worktree list", ROOT_CTX),
    ).toBeUndefined();
    expect(giwtRerouteForCommand("git --bare worktree list", ROOT_CTX)).toBeUndefined();
  });

  test("wrapper tokens, chain prefixes, pipes, expansion, comments pass", () => {
    expect(giwtRerouteForCommand("sudo git worktree list", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("nohup git worktree list", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("timeout 5 git worktree list", ROOT_CTX)).toBeUndefined();
    // `cd … &&` splits into segments; the git segment rewrites and the cd
    // stays — giwt resolves from cwd exactly like git, so this is sound.
    expect(giwtRerouteForCommand("cd /repo && git worktree list", ROOT_CTX)).toEqual({
      command: "cd /repo && giwt list",
    });
    expect(giwtRerouteForCommand("git worktree list | wc -l", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("echo $(git worktree list)", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand('git worktree list "unterminated', ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("# git worktree list", ROOT_CTX)).toBeUndefined();
    expect(giwtRerouteForCommand("", ROOT_CTX)).toBeUndefined();
  });

  test("env prefixes are preserved across the rewrite", () => {
    expect(giwtRerouteForCommand("FOO=1 git worktree list", ROOT_CTX)).toEqual({
      command: "FOO=1 giwt list",
    });
    expect(giwtRerouteForCommand('BAR="a b" git worktree prune', ROOT_CTX)).toEqual({
      command: 'BAR="a b" giwt cleanup',
    });
    expect(giwtRerouteForCommand("FOO=1 git merge master", WORKTREE_CTX)).toEqual({
      command: "FOO=1 giwt merge master",
    });
  });

  test("unavailable giwt disables every rewrite and nudge", () => {
    expect(giwtRerouteForCommand("git worktree list", UNAVAILABLE)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree prune", UNAVAILABLE)).toBeUndefined();
    expect(giwtRerouteForCommand("git worktree add ../x", UNAVAILABLE)).toBeUndefined();
    expect(giwtRerouteForCommand("git merge master", UNAVAILABLE)).toBeUndefined();
  });
});

describe("giwtRerouteForCommand — chains", () => {
  test("multiple mapped segments rewrite with separators preserved", () => {
    expect(giwtRerouteForCommand("git worktree list && git worktree prune", ROOT_CTX)).toEqual({
      command: "giwt list && giwt cleanup",
    });
    expect(giwtRerouteForCommand("git worktree list; git status", ROOT_CTX)).toEqual({
      command: "giwt list; git status",
    });
  });

  test("mixed mapped/unmapped chains rewrite only the mapped segment", () => {
    expect(giwtRerouteForCommand("git worktree list && git log --oneline", ROOT_CTX)).toEqual({
      command: "giwt list && git log --oneline",
    });
  });

  test("duplicate segment text splices at the right offset", () => {
    expect(giwtRerouteForCommand("git worktree list && git worktree list", ROOT_CTX)).toEqual({
      command: "giwt list && giwt list",
    });
  });
});

describe("default hook wiring", () => {
  class FakeHooks {
    handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | undefined;
    on(_event: string, handler: typeof FakeHooks.prototype.handler): void {
      this.handler = handler;
    }
  }

  function registerFake(): (event: {
    toolName: string;
    input: Record<string, unknown>;
  }) => unknown {
    const hooks = new FakeHooks();
    // The hook factory is typed against the harness HookAPI; the FakeHooks
    // shim is structurally the one-method surface the factory uses.
    const factory = defaultHook as unknown as (pi: FakeHooks) => void;
    factory(hooks);
    const handler = hooks.handler;
    if (!handler) throw new Error("hook handler not registered");
    return handler;
  }

  test("rewrites mapped bash commands and preserves other input fields", () => {
    const handler = registerFake();
    expect(handler({ toolName: "bash", input: { command: "git worktree list" } })).toEqual({
      input: { command: "giwt list" },
    });
    expect(
      handler({ toolName: "bash", input: { command: "git worktree list", timeout: 30 } }),
    ).toEqual({ input: { command: "giwt list", timeout: 30 } });
  });

  test("worktree add yields additionalContext, not a rewrite", () => {
    const handler = registerFake();
    expect(handler({ toolName: "bash", input: { command: "git worktree add ../x" } })).toEqual({
      additionalContext: WORKTREE_ADD_NUDGE,
    });
  });

  test("non-bash tools and ask-gated ops pass through", () => {
    const handler = registerFake();
    expect(handler({ toolName: "read", input: { path: "x" } })).toBeUndefined();
    expect(
      handler({ toolName: "bash", input: { command: "git push origin main" } }),
    ).toBeUndefined();
    expect(handler({ toolName: "bash", input: {} })).toBeUndefined();
  });
});
