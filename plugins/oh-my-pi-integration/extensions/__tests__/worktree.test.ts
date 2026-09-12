import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  buildWorktreePrompt,
  registerWorktree,
  resolveWorktreeTarget,
  validateWorktreeName,
} from "../commands/worktree";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

class FakePi {
  commands = new Map<string, { description?: string; handler: CommandHandler }>();
  execCalls: Array<{ command: string; args: string[] }> = [];
  throwOnExec = false;
  sentUserMessages: string[] = [];

  registerCommand(name: string, opts: { description?: string; handler: CommandHandler }): void {
    this.commands.set(name, opts);
  }

  async exec(command: string, args: string[]): Promise<{ stdout?: string }> {
    this.execCalls.push({ command, args });
    if (this.throwOnExec) throw new Error("fatal: a branch named 'x' already exists");
    return { stdout: "" };
  }

  async sendUserMessage(content: string): Promise<void> {
    this.sentUserMessages.push(content);
  }
}

function makeCtx(cwd: string, notified: Array<[string, string | undefined]> = []) {
  return {
    cwd,
    ui: { notify: (message: string, level?: string) => notified.push([message, level]) },
  } as unknown as ExtensionCommandContext;
}

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("validateWorktreeName", () => {
  test("accepts flat branch-safe names", () => {
    expect(validateWorktreeName("ci-fixes")).toBe(true);
    expect(validateWorktreeName("feat_x.2")).toBe(true);
  });

  test("rejects slashes, traversal, and empties", () => {
    expect(validateWorktreeName("../x")).toBe(false);
    expect(validateWorktreeName("a/b")).toBe(false);
    expect(validateWorktreeName("")).toBe(false);
    expect(validateWorktreeName("has space")).toBe(false);
  });
});

describe("resolveWorktreeTarget", () => {
  test("defaults to tree/ container", () => {
    const root = tempDir("wt-def-");
    const target = resolveWorktreeTarget(root, "ci-fixes");
    expect(target).toMatchObject({ root, container: "tree", name: "ci-fixes", existed: false });
    expect(target.path).toBe(join(root, "tree", "ci-fixes"));
  });

  test("prefers an existing .worktrees container", () => {
    const root = tempDir("wt-wt-");
    mkdirSync(join(root, ".worktrees"), { recursive: true });
    expect(resolveWorktreeTarget(root, "x").container).toBe(".worktrees");
  });

  test("resolves siblings when invoked inside a worktree", () => {
    const root = tempDir("wt-sib-");
    const cwd = join(root, "tree", "old-branch");
    mkdirSync(cwd, { recursive: true });
    const target = resolveWorktreeTarget(cwd, "new-branch");
    expect(target.root).toBe(root);
    expect(target.path).toBe(join(root, "tree", "new-branch"));
  });

  test("marks pre-existing checkouts as reuse", () => {
    const root = tempDir("wt-re-");
    mkdirSync(join(root, "tree", "resume-me"), { recursive: true });
    expect(resolveWorktreeTarget(root, "resume-me").existed).toBe(true);
  });
});

describe("buildWorktreePrompt", () => {
  test("scopes the turn to the checkout and names the task", () => {
    const root = tempDir("wt-p-");
    const prompt = buildWorktreePrompt(
      {
        root,
        container: "tree",
        name: "ci-fixes",
        path: join(root, "tree", "ci-fixes"),
        existed: false,
      },
      "Proceed with fixes for Github CICD",
      true,
    );
    expect(prompt).toContain("tree/ci-fixes/");
    expect(prompt).toContain("Proceed with fixes for Github CICD");
    expect(prompt).toContain("just created");
    expect(prompt).toContain("/finalize");
  });

  test("notes checkout reuse", () => {
    const root = tempDir("wt-pr-");
    const prompt = buildWorktreePrompt(
      { root, container: "tree", name: "x", path: join(root, "tree", "x"), existed: true },
      "continue",
      false,
    );
    expect(prompt).toContain("reused");
  });
});

describe("worktree handler", () => {
  function setup(): FakePi {
    const pi = new FakePi();
    registerWorktree(pi as unknown as ExtensionAPI);
    return pi;
  }

  test("missing name or task is a usage error", async () => {
    const pi = setup();
    const notified: Array<[string, string | undefined]> = [];
    const cwd = tempDir("wt-hu-");
    await pi.commands.get("worktree")?.handler("", makeCtx(cwd, notified));
    await pi.commands.get("worktree")?.handler("lonely-name", makeCtx(cwd, notified));
    expect(notified).toHaveLength(2);
    expect(notified.every(([, level]) => level === "error")).toBe(true);
    expect(pi.execCalls).toHaveLength(0);
    expect(pi.sentUserMessages).toHaveLength(0);
  });

  test("invalid names never reach git", async () => {
    const pi = setup();
    const notified: Array<[string, string | undefined]> = [];
    const cwd = tempDir("wt-hbad-");
    await pi.commands.get("worktree")?.handler("../evil do things", makeCtx(cwd, notified));
    expect(notified[0]?.[0]).toContain("[A-Za-z0-9._-]");
    expect(pi.execCalls).toHaveLength(0);
    expect(pi.sentUserMessages).toHaveLength(0);
  });

  test("creates the checkout then starts the scoped turn", async () => {
    const pi = setup();
    const root = tempDir("wt-hcreate-");
    await pi.commands
      .get("worktree")
      ?.handler("ci-fixes Proceed with fixes for Github CICD", makeCtx(root));
    expect(pi.execCalls).toEqual([
      {
        command: "git",
        args: ["worktree", "add", "-b", "ci-fixes", join(root, "tree", "ci-fixes")],
      },
    ]);
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("tree/ci-fixes/");
    expect(pi.sentUserMessages[0]).toContain("Proceed with fixes for Github CICD");
  });

  test("creation failure notifies and spends no turn", async () => {
    const pi = setup();
    pi.throwOnExec = true;
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands
      .get("worktree")
      ?.handler("taken do work", makeCtx(tempDir("wt-hfail-"), notified));
    expect(notified[0]?.[0]).toContain("could not create worktree");
    expect(notified[0]?.[1]).toBe("error");
    expect(pi.sentUserMessages).toHaveLength(0);
  });

  test("existing checkout skips creation and reuses", async () => {
    const pi = setup();
    const root = tempDir("wt-hreuse-");
    mkdirSync(join(root, "tree", "resume-me"), { recursive: true });
    await pi.commands.get("worktree")?.handler("resume-me keep going", makeCtx(root));
    expect(pi.execCalls).toHaveLength(0);
    expect(pi.sentUserMessages[0]).toContain("reused");
  });
});
