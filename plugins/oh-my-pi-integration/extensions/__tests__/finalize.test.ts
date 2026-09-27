import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  buildFinalizePrompt,
  buildGiwtFinalizePrompt,
  detectFinalizeEnv,
  type FinalizeEnv,
  registerFinalize,
} from "../commands/finalize";

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

function binDirWith(bin: string): string {
  const dir = tempDir(`fin-bin-${bin}-`);
  writeFileSync(join(dir, bin), "#!/bin/sh\n");
  return dir;
}

describe("detectFinalizeEnv", () => {
  test("plain dir has no worktree state", () => {
    const env = detectFinalizeEnv(tempDir("fin-plain-"), tempDir("fin-path-"));
    expect(env.inWorktree).toBe(false);
    expect(env.branchGuess).toBeNull();
    expect(env.worktreeCli).toBe(false);
    expect(env.worktreeDir).toBeNull();
    expect(env.giwtOnPath).toBe(false);
    expect(env.lastRunId).toBeNull();
  });

  test("undefined cwd falls back to process cwd", () => {
    // Use a tempdir so the assertion is independent of the test runner's cwd.
    // detectFinalizeEnv returns the worktree-managed repo root, not the cwd:
    // when cwd is inside tree/<branch>, root is the parent repo, not cwd.
    const plainCwd = tempDir("fin-undef-");
    const prevCwd = process.cwd();
    try {
      process.chdir(plainCwd);
      expect(detectFinalizeEnv(undefined).root).toBe(plainCwd);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("cwd inside tree/ resolves root, cli and branch guess", () => {
    const root = tempDir("fin-tree-");
    scaffoldWorktreeCli(root, "index.ts");
    const cwd = join(root, "tree", "feat-x");
    mkdirSync(cwd, { recursive: true });
    const env = detectFinalizeEnv(cwd, tempDir("fin-path-"));
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
    const env = detectFinalizeEnv(root, tempDir("fin-path-"));
    expect(env.worktreeCli).toBe(true);
    expect(env.worktreeDir).toBe(".worktrees");
    expect(env.inWorktree).toBe(false);
  });

  test("detects legacy worktree.sh cli", () => {
    const root = tempDir("fin-sh-");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "worktree.sh"), "#!/bin/sh");
    expect(detectFinalizeEnv(root, tempDir("fin-path-")).worktreeCli).toBe(true);
  });

  test("giwt on PATH satisfies worktreeCli without scripts/worktree", () => {
    const env = detectFinalizeEnv(tempDir("fin-giwt-"), binDirWith("giwt"));
    expect(env.giwtOnPath).toBe(true);
    expect(env.worktreeCli).toBe(true);
  });

  test("lastRunId is the lexicographically newest run dir", () => {
    const root = tempDir("fin-runs-");
    const runs = join(root, ".tmp", "giwt", "runs");
    mkdirSync(join(runs, "20260925-0900-77-w-ticket"), { recursive: true });
    mkdirSync(join(runs, "20260926-111-x-finalize"), { recursive: true });
    writeFileSync(join(runs, "9999-not-a-dir"), "{}");
    const env = detectFinalizeEnv(root, tempDir("fin-path-"));
    expect(env.lastRunId).toBe("20260926-111-x-finalize");
  });
});

describe("buildFinalizePrompt", () => {
  test("cli repos get REPO_ROOT guidance", () => {
    const env = detectFinalizeEnv(tempDir("fin-pcli-"), tempDir("fin-path-"));
    const prompt = buildFinalizePrompt({ ...env, worktreeCli: true }, "feat-x");
    expect(prompt).toContain("feat-x");
    expect(prompt).toContain("REPO_ROOT");
    expect(prompt).toContain("blocked-dirty");
  });

  test("cli-less repos get plain-git merge step", () => {
    const env = detectFinalizeEnv(tempDir("fin-pgit-"), tempDir("fin-path-"));
    const prompt = buildFinalizePrompt(env, "feat-y");
    expect(prompt).toContain("plain git");
    expect(prompt).toContain("refs/heads/feat-y");
  });

  test("giwt on PATH merges via giwt without the legacy REPO_ROOT guidance", () => {
    const env = detectFinalizeEnv(tempDir("fin-pgw-"), tempDir("fin-path-"));
    const prompt = buildFinalizePrompt({ ...env, giwtOnPath: true, worktreeCli: true }, "feat-g");
    expect(prompt).toContain("giwt finalize feat-g");
    expect(prompt).not.toContain("bun run scripts/worktree/");
    expect(prompt).not.toContain("retry with REPO_ROOT");
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

  test("confirmation and red-verdict reporting route through the ask tool", () => {
    const prompt = buildFinalizePrompt(detectFinalizeEnv(process.cwd()), "feat-ask");
    expect(prompt).toContain("use the ask tool");
    expect(prompt).toContain("proceed / abort");
    expect(prompt).toContain("report it via the ask tool");
  });
});

function giwtEnv(over: Partial<FinalizeEnv>): FinalizeEnv {
  return {
    root: "/tmp/fake-root",
    worktreeCli: true,
    worktreeDir: null,
    inWorktree: false,
    branchGuess: null,
    giwtAvailable: true,
    planIndex: false,
    giwtOnPath: true,
    lastRunId: null,
    ...over,
  };
}

describe("buildGiwtFinalizePrompt", () => {
  test("instructs agent to use giwt finalize with audit pre-checks", () => {
    const prompt = buildGiwtFinalizePrompt(
      giwtEnv({ planIndex: true, lastRunId: "20260926-111-x-finalize" }),
      "my-feature",
    );
    expect(prompt).toContain("giwt");
    expect(prompt).toContain("my-feature");
    expect(prompt).toContain("giwt finalize my-feature");
    expect(prompt).not.toContain("REPO_ROOT");
    expect(prompt).toContain("Audit before merge");
    expect(prompt).toContain("Merge-with-gates");
    expect(prompt).toContain("Lockfile safety");
    expect(prompt).toContain("GPG signing");
    expect(prompt).toContain("Confirm with the user");
    expect(prompt).toContain("use the ask tool");
    expect(prompt).toContain("giwt finalize my-feature --plan-gates all");
    expect(prompt).toContain("failedGates");
    expect(prompt).toContain("check.log");
  });

  test("adds --plan-gates to the command only when a .plan index exists", () => {
    const withPlan = buildGiwtFinalizePrompt(giwtEnv({ planIndex: true }), "b1");
    expect(withPlan).toContain("giwt finalize b1 --plan-gates all");
    expect(withPlan).toContain("Plan validation gate");
    const withoutPlan = buildGiwtFinalizePrompt(giwtEnv({ planIndex: false }), "b2");
    expect(withoutPlan).not.toContain("--plan-gates");
    expect(withoutPlan).toContain("No plan gate");
  });

  test("names failing gates from the recorded last run", () => {
    const prompt = buildGiwtFinalizePrompt(giwtEnv({ lastRunId: "20260926-111-x-finalize" }), "b3");
    expect(prompt).toContain(".tmp/giwt/runs/20260926-111-x-finalize/meta.json");
    expect(prompt).toContain("outcome.failedGates");
    expect(prompt).toContain("last giwt run 20260926-111-x-finalize");
  });

  test("falls back to the latest run slot when lastRunId is unknown", () => {
    const prompt = buildGiwtFinalizePrompt(giwtEnv({ lastRunId: null }), "b4");
    expect(prompt).toContain(".tmp/giwt/runs/<latest>/meta.json");
    expect(prompt).not.toContain("last giwt run");
  });
});
