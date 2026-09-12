import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  bookkeepUsage,
  buildAuditPrompt,
  buildFindPrompt,
  buildIssuePrompt,
  buildSyncPrompt,
  detectBookkeepEnv,
  registerBookkeep,
} from "../commands/bookkeep";

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

const savedPath = process.env.PATH;
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.env.PATH = savedPath;
});

function scaffoldPlanRepo(root: string): void {
  mkdirSync(join(root, ".plan"), { recursive: true });
  mkdirSync(join(root, "scripts/worktree"), { recursive: true });
  writeFileSync(join(root, "scripts/worktree", "ticket.ts"), "// tracker cli");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { "plan:sync": "sync", "plan:find": "find" } }),
  );
}

function scaffoldBins(withJira: boolean): void {
  const bin = join(tempDir("bk-bin-"), "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), "#!/bin/sh");
  if (withJira) writeFileSync(join(bin, "jira"), "#!/bin/sh");
  process.env.PATH = `${bin}:${savedPath}`;
}

describe("detectBookkeepEnv", () => {
  test("empty dir detects nothing", () => {
    const env = detectBookkeepEnv(tempDir("bk-empty-"));
    expect(env.planDir).toBe(false);
    expect(env.planScripts).toEqual([]);
    expect(env.worktreeTracker).toBe(false);
  });

  test("undefined cwd falls back to process cwd", () => {
    expect(detectBookkeepEnv(undefined).root).toBe(process.cwd());
  });

  test("plan repo with tracker cli and bins on PATH", () => {
    scaffoldBins(true);
    const root = tempDir("bk-full-");
    scaffoldPlanRepo(root);
    const env = detectBookkeepEnv(root);
    expect(env.planDir).toBe(true);
    expect(env.planScripts).toEqual(["plan:sync", "plan:find"]);
    expect(env.worktreeTracker).toBe(true);
    expect(env.gh).toBe(true);
    expect(env.jira).toBe(true);
  });

  test("malformed package.json yields no scripts", () => {
    const root = tempDir("bk-badpkg-");
    writeFileSync(join(root, "package.json"), "{not json");
    expect(detectBookkeepEnv(root).planScripts).toEqual([]);
  });
});

describe("prompt builders", () => {
  test("audit prompt names the target and index command", () => {
    const root = tempDir("bk-audit-");
    scaffoldPlanRepo(root);
    const prompt = buildAuditPrompt(detectBookkeepEnv(root), "EPIC-1");
    expect(prompt).toContain("EPIC-1");
    expect(prompt).toContain("bun run plan:sync");
    expect(prompt).toContain("do NOT close");
  });

  test("audit prompt without .plan falls back to tracker backends", () => {
    const prompt = buildAuditPrompt(detectBookkeepEnv(tempDir("bk-auditno-")), "T-9");
    expect(prompt).toContain("No .plan/ dir");
    expect(prompt).toContain("tracker backend");
  });

  test("sync prompt is read-only without --fix", () => {
    const root = tempDir("bk-sync-");
    scaffoldPlanRepo(root);
    const prompt = buildSyncPrompt(detectBookkeepEnv(root), false);
    expect(prompt).toContain("bun run plan:sync");
    expect(prompt).toContain("Read-only");
    expect(prompt).not.toContain("plan:sync --fix");
  });

  test("sync prompt passes --fix through", () => {
    const root = tempDir("bk-syncfix-");
    scaffoldPlanRepo(root);
    expect(buildSyncPrompt(detectBookkeepEnv(root), true)).toContain("--fix");
  });

  test("sync prompt without index command explains the fallback", () => {
    const prompt = buildSyncPrompt(detectBookkeepEnv(tempDir("bk-syncno-")), false);
    expect(prompt).toContain("No planning-index command");
  });

  test("find prompt prefers plan:find, then grep, then tracker", () => {
    const withFind = tempDir("bk-find-");
    scaffoldPlanRepo(withFind);
    expect(buildFindPrompt(detectBookkeepEnv(withFind), "auth")).toContain("bun run plan:find");
    const planOnly = tempDir("bk-findgrep-");
    mkdirSync(join(planOnly, ".plan"), { recursive: true });
    expect(buildFindPrompt(detectBookkeepEnv(planOnly), "auth")).toContain("grep over .plan");
    const bare = detectBookkeepEnv(tempDir("bk-findbare-"));
    expect(buildFindPrompt(bare, "auth")).toContain("tracker backend");
  });

  test("issue prompt lists backends in order with the request", () => {
    scaffoldBins(false);
    const prompt = buildIssuePrompt(detectBookkeepEnv(tempDir("bk-issue-")), "close T-3");
    expect(prompt).toContain("close T-3");
    expect(prompt).toContain("gh auth status");
    expect(prompt).toContain("need user confirm");
  });

  test("usage summarizes the detected environment", () => {
    const usage = bookkeepUsage(detectBookkeepEnv(tempDir("bk-usage-")));
    expect(usage).toContain("audit <epic|ticket>|sync");
    expect(usage).toContain(".plan no");
  });
});

describe("bookkeep handler", () => {
  function setup(_cwd: string): { pi: FakePi; notified: Array<[string, string | undefined]> } {
    const pi = new FakePi();
    registerBookkeep(pi as unknown as ExtensionAPI);
    return { pi, notified: [] as Array<[string, string | undefined]> };
  }

  test("bare invoke shows usage without spending a turn", async () => {
    const { pi, notified } = setup(tempDir("bk-hbare-"));
    await pi.commands.get("bookkeep")?.handler("", makeCtx(tempDir("bk-hbare2-"), notified));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("bookkeep <audit");
  });

  test("audit without target errors", async () => {
    const { pi, notified } = setup(tempDir("bk-haudit0-"));
    await pi.commands.get("bookkeep")?.handler("audit", makeCtx(tempDir("bk-haudit0b-"), notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(pi.sentUserMessages).toHaveLength(0);
  });

  test("audit starts the reconcile turn", async () => {
    const root = tempDir("bk-haudit-");
    scaffoldPlanRepo(root);
    const { pi } = setup(root);
    await pi.commands.get("bookkeep")?.handler("audit EPIC-2", makeCtx(root));
    expect(pi.sentUserMessages[0]).toContain("EPIC-2");
  });

  test("sync starts the index turn, --fix passes through", async () => {
    const root = tempDir("bk-hsync-");
    scaffoldPlanRepo(root);
    const { pi } = setup(root);
    await pi.commands.get("bookkeep")?.handler("sync --fix", makeCtx(root));
    expect(pi.sentUserMessages[0]).toContain("--fix");
  });

  test("find without query errors", async () => {
    const { pi, notified } = setup(tempDir("bk-hfind0-"));
    const cwd = tempDir("bk-hfind0b-");
    await pi.commands.get("bookkeep")?.handler("find", makeCtx(cwd, notified));
    expect(notified[0]?.[1]).toBe("error");
  });

  test("find starts the search turn", async () => {
    const { pi } = setup(tempDir("bk-hfind-"));
    const cwd = tempDir("bk-hfindb-");
    await pi.commands.get("bookkeep")?.handler("find token refresh", makeCtx(cwd));
    expect(pi.sentUserMessages[0]).toContain("token refresh");
  });

  test("issue without request errors", async () => {
    const { pi, notified } = setup(tempDir("bk-hissue0-"));
    const cwd = tempDir("bk-hissue0b-");
    await pi.commands.get("bookkeep")?.handler("issue", makeCtx(cwd, notified));
    expect(notified[0]?.[1]).toBe("error");
  });

  test("issue starts the tracker turn", async () => {
    const { pi } = setup(tempDir("bk-hissue-"));
    const cwd = tempDir("bk-hissueb-");
    await pi.commands.get("bookkeep")?.handler("issue list open bugs", makeCtx(cwd));
    expect(pi.sentUserMessages[0]).toContain("list open bugs");
  });

  test("unknown subcommand errors with usage", async () => {
    const { pi, notified } = setup(tempDir("bk-hunknown-"));
    const cwd = tempDir("bk-hunknownb-");
    await pi.commands.get("bookkeep")?.handler("frobnicate x", makeCtx(cwd, notified));
    expect(notified[0]?.[0]).toContain("unknown subcommand");
    expect(notified[0]?.[1]).toBe("error");
    expect(pi.sentUserMessages).toHaveLength(0);
  });
});
