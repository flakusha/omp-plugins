import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  buildWtPrompt,
  buildWtStatus,
  detectWtEnv,
  registerWt,
  WT_TOML_TEMPLATE,
  type WtEnv,
} from "../commands/wt";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

class FakePi {
  commands = new Map<string, { description?: string; handler: CommandHandler }>();
  sentUserMessages: string[] = [];

  registerCommand(name: string, opts: { description?: string; handler: CommandHandler }): void {
    this.commands.set(name, opts);
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

function binDirWith(bin: string): string {
  const dir = tempDir(`wt-bin-${bin}-`);
  writeFileSync(join(dir, bin), "#!/bin/sh\n");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function envWith(over: Partial<WtEnv>): WtEnv {
  return {
    root: "/repo",
    wtOnPath: false,
    wtToml: false,
    worktreeCli: true,
    planDir: true,
    gitIssue: true,
    ...over,
  };
}

describe("detectWtEnv", () => {
  test("empty dir detects no wt, no toml, no tracker", () => {
    const env = detectWtEnv(tempDir("wt-empty-"), tempDir("wt-path-"));
    expect(env.wtOnPath).toBe(false);
    expect(env.wtToml).toBe(false);
    expect(env.worktreeCli).toBe(false);
    expect(env.planDir).toBe(false);
  });

  test("fake wt on PATH is detected", () => {
    const env = detectWtEnv(tempDir("wt-empty-"), binDirWith("wt"));
    expect(env.wtOnPath).toBe(true);
  });

  test("wt.toml and tracker CLI are detected", () => {
    const root = tempDir("wt-proj-");
    mkdirSync(join(root, ".config"), { recursive: true });
    writeFileSync(join(root, ".config", "wt.toml"), 'worktree-path = "x"\n');
    mkdirSync(join(root, "scripts", "worktree"), { recursive: true });
    writeFileSync(join(root, "scripts", "worktree", "index.ts"), "export {};\n");
    const env = detectWtEnv(root, tempDir("wt-path-"));
    expect(env.wtToml).toBe(true);
    expect(env.worktreeCli).toBe(true);
  });
});

describe("buildWtStatus", () => {
  test("mentions fallback when wt missing and init when toml missing", () => {
    const text = buildWtStatus(envWith({ wtOnPath: false, wtToml: false }));
    expect(text).toContain("not on PATH");
    expect(text).toContain("/wt init");
    expect(text).toContain("usage:");
  });

  test("confirms wt and hooks when present", () => {
    const text = buildWtStatus(envWith({ wtOnPath: true, wtToml: true }));
    expect(text).toContain("available");
    expect(text).toContain(".config/wt.toml present");
  });
});

describe("buildWtPrompt", () => {
  test("init embeds the toml template", () => {
    const text = buildWtPrompt(envWith({}), "init", "");
    expect(text).toContain(".config/wt.toml");
    expect(text).toContain('worktree-path = "tree/{{ branch | sanitize }}"');
    expect(text).toContain("wt step copy-ignored");
  });

  test("tracker ops route to the repo CLI even when wt is present", () => {
    const text = buildWtPrompt(envWith({ wtOnPath: true }), "ticket", "TASK title");
    expect(text).toContain("bun run scripts/worktree/ ticket TASK title");
    expect(text).not.toContain("`wt ticket`");
  });

  test("Object.prototype names route to lifecycle, not tracker", () => {
    const text = buildWtPrompt(envWith({ wtOnPath: true }), "constructor", "");
    expect(text).toContain("`wt constructor`");
  });

  test("lifecycle uses wt when present", () => {
    const text = buildWtPrompt(envWith({ wtOnPath: true, wtToml: true }), "switch", "-c feat");
    expect(text).toContain("`wt switch -c feat`");
    expect(text).toContain("/finalize");
  });

  test("lifecycle falls back to git when wt is missing", () => {
    const text = buildWtPrompt(envWith({ wtOnPath: false }), "switch", "feat");
    expect(text).toContain("not installed");
    expect(text).toContain("git worktree add -b");
  });
});

describe("WT_TOML_TEMPLATE", () => {
  test("bridges lifecycle and tracker", () => {
    expect(WT_TOML_TEMPLATE).toContain("wt step copy-ignored");
    expect(WT_TOML_TEMPLATE).toContain("bun run check");
    expect(WT_TOML_TEMPLATE).toContain("scripts/worktree/ ticket");
  });
});

describe("wt handler", () => {
  test("bare and status notify without a turn", async () => {
    const pi = new FakePi();
    registerWt(pi as unknown as ExtensionAPI);
    const handler = pi.commands.get("wt")?.handler;
    if (!handler) throw new Error("wt command not registered");
    const notified: Array<[string, string | undefined]> = [];
    const root = tempDir("wt-handler-");
    await handler("", makeCtx(root, notified));
    await handler("status", makeCtx(root, notified));
    expect(notified.length).toBe(2);
    expect(pi.sentUserMessages.length).toBe(0);
  });

  test("lifecycle subcommand starts a turn", async () => {
    const pi = new FakePi();
    registerWt(pi as unknown as ExtensionAPI);
    const handler = pi.commands.get("wt")?.handler;
    const root = tempDir("wt-handler-");
    await handler("list --full", makeCtx(root));
    expect(pi.sentUserMessages.length).toBe(1);
    expect(pi.sentUserMessages[0]).toContain("wt list --full");
  });
});
