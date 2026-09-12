import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { buildFinalizePrompt, detectFinalizeEnv, registerFinalize } from "../commands/finalize";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

class FakePi {
  commands = new Map<string, { description?: string; handler: CommandHandler }>();
  execCalls: Array<{ command: string; args: string[] }> = [];
  scripted: Array<{ stdout?: string }> = [];
  throwOnExec = false;
  sentUserMessages: string[] = [];

  registerCommand(name: string, opts: { description?: string; handler: CommandHandler }): void {
    this.commands.set(name, opts);
  }

  async exec(command: string, args: string[]): Promise<{ stdout?: string }> {
    this.execCalls.push({ command, args });
    if (this.throwOnExec) throw new Error("git down");
    return this.scripted.shift() ?? { stdout: "" };
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

function registered(): Map<string, { description?: string; handler: CommandHandler }> {
  const pi = new FakePi();
  registerFinalize(pi as unknown as ExtensionAPI);
  return pi.commands;
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

function scaffoldWorktreeCli(root: string, entry: string): void {
  mkdirSync(join(root, "scripts/worktree"), { recursive: true });
  writeFileSync(join(root, "scripts/worktree", entry), "// cli");
}

describe("detectFinalizeEnv", () => {
  test("plain dir has no worktree state", () => {
    const env = detectFinalizeEnv(tempDir("fin-plain-"));
    expect(env.inWorktree).toBe(false);
    expect(env.branchGuess).toBeNull();
    expect(env.worktreeCli).toBe(false);
    expect(env.worktreeDir).toBeNull();
  });

  test("undefined cwd falls back to process cwd", () => {
    expect(detectFinalizeEnv(undefined).root).toBe(process.cwd());
  });

  test("cwd inside tree/ resolves root, cli and branch guess", () => {
    const root = tempDir("fin-tree-");
    scaffoldWorktreeCli(root, "index.ts");
    const cwd = join(root, "tree", "feat-x");
    mkdirSync(cwd, { recursive: true });
    const env = detectFinalizeEnv(cwd);
    expect(env.root).toBe(root);
    expect(env.inWorktree).toBe(true);
    expect(env.worktreeCli).toBe(true);
    expect(env.worktreeDir).toBe("tree");
    expect(env.branchGuess).toBe("feat-x");
  });

  test("detects index.mjs cli and .worktrees container", () => {
    const root = tempDir("fin-mjs-");
    scaffoldWorktreeCli(root, "index.mjs");
    mkdirSync(join(root, ".worktrees"), { recursive: true });
    const env = detectFinalizeEnv(root);
    expect(env.worktreeCli).toBe(true);
    expect(env.worktreeDir).toBe(".worktrees");
    expect(env.inWorktree).toBe(false);
  });

  test("detects legacy worktree.sh cli", () => {
    const root = tempDir("fin-sh-");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "worktree.sh"), "#!/bin/sh");
    expect(detectFinalizeEnv(root).worktreeCli).toBe(true);
  });
});

describe("buildFinalizePrompt", () => {
  test("cli repos get REPO_ROOT guidance", () => {
    const env = detectFinalizeEnv(tempDir("fin-pcli-"));
    const prompt = buildFinalizePrompt({ ...env, worktreeCli: true }, "feat-x");
    expect(prompt).toContain("feat-x");
    expect(prompt).toContain("REPO_ROOT");
    expect(prompt).toContain("blocked-dirty");
  });

  test("cli-less repos get plain-git merge step", () => {
    const env = detectFinalizeEnv(tempDir("fin-pgit-"));
    const prompt = buildFinalizePrompt(env, "feat-y");
    expect(prompt).toContain("plain git");
    expect(prompt).toContain("refs/heads/feat-y");
  });
});

describe("finalize handler", () => {
  test("status lists worktrees without spending a turn", async () => {
    const pi = new FakePi();
    registerFinalize(pi as unknown as ExtensionAPI);
    pi.scripted.push({ stdout: "/repo  abc123 [dev]\n/repo/tree/feat-x  def456 [feat-x]" });
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("finalize")?.handler("status", makeCtx(tempDir("fin-st-"), notified));
    expect(pi.execCalls[0]).toEqual({ command: "git", args: ["worktree", "list"] });
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[0]).toContain("feat-x");
    expect(notified[0]?.[1]).toBe("info");
  });

  test("status with no worktrees reports empty", async () => {
    const pi = new FakePi();
    registerFinalize(pi as unknown as ExtensionAPI);
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("finalize")?.handler("status", makeCtx(tempDir("fin-ste-"), notified));
    expect(notified[0]?.[0]).toBe("no linked worktrees");
  });

  test("status exec failure warns instead of breaking", async () => {
    const pi = new FakePi();
    registerFinalize(pi as unknown as ExtensionAPI);
    pi.throwOnExec = true;
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("finalize")?.handler("status", makeCtx(tempDir("fin-stf-"), notified));
    expect(notified[0]?.[1]).toBe("warning");
  });

  test("extra args are a usage error", async () => {
    const handler = registered().get("finalize")?.handler;
    const notified: Array<[string, string | undefined]> = [];
    await handler?.("a b", makeCtx(tempDir("fin-args-"), notified));
    expect(notified[0]?.[1]).toBe("error");
  });

  test("bare invoke at root without branch errors", async () => {
    const handler = registered().get("finalize")?.handler;
    const notified: Array<[string, string | undefined]> = [];
    await handler?.("", makeCtx(tempDir("fin-bare-"), notified));
    expect(notified[0]?.[0]).toContain("not inside a worktree");
    expect(notified[0]?.[1]).toBe("error");
  });

  test("bare invoke inside worktree finalizes the guessed branch", async () => {
    const pi = new FakePi();
    registerFinalize(pi as unknown as ExtensionAPI);
    const root = tempDir("fin-guess-");
    const cwd = join(root, "tree", "feat-guess");
    mkdirSync(cwd, { recursive: true });
    await pi.commands.get("finalize")?.handler("", makeCtx(cwd));
    expect(pi.sentUserMessages[0]).toContain("feat-guess");
  });

  test("explicit branch starts the finalize turn", async () => {
    const pi = new FakePi();
    registerFinalize(pi as unknown as ExtensionAPI);
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("finalize")?.handler("feat-ship", makeCtx(tempDir("fin-exp-"), notified));
    expect(notified).toHaveLength(0);
    expect(pi.sentUserMessages[0]).toContain("feat-ship");
    expect(pi.sentUserMessages[0]).toContain("Confirm with the user");
  });
});
