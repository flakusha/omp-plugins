import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  buildVerifyPrompt,
  registerCommands,
  renderReceiptStatus,
  runRecall,
} from "../commands/commands";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

// Minimal double: only the surface registerCommands + handlers touch.
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
    if (this.throwOnExec) throw new Error("engram down");
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
  registerCommands(pi as unknown as ExtensionAPI);
  return pi.commands;
}

function writeLedger(cwd: string, text: string): void {
  mkdirSync(join(cwd, ".omp"), { recursive: true });
  writeFileSync(join(cwd, ".omp", "receipt.toml"), text);
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

const LEDGER = `[[job]]
F-01 = "make the cicd happy"
state = "finished"
[[job]]
F-02 = "improve database performance"
state = "in progress"
[[job]]
# Blocker
F-03 = "needs live db access"
[[issue]]
tooling = "failed to access report.json"
`;

const ENGRAM_HIT = `[1] #611 (session_summary) — remembered fix
some useful detail
`;

describe("registerCommands", () => {
  test("registers receipt, verify, recall, find-work, finalize, bookkeep, and worktree with descriptions", () => {
    const commands = registered();
    expect([...commands.keys()].sort()).toEqual([
      "bookkeep",
      "finalize",
      "find-work",
      "recall",
      "receipt",
      "verify",
      "worktree",
      "wt",
    ]);
    for (const { description } of commands.values()) {
      expect(description).toBeString();
    }
  });
});

describe("renderReceiptStatus", () => {
  test("labels finished, in-progress, default-state, blocker, and issue lines", () => {
    const lines = renderReceiptStatus(LEDGER);
    expect(lines[0]).toBe("[receipt n=0]");
    expect(lines).toContain("job finished F-01: make the cicd happy");
    expect(lines).toContain("job (in progress) F-02: improve database performance");
    expect(lines).toContain("job (in progress) [blocker] F-03: needs live db access");
    expect(lines).toContain("issue tooling: failed to access report.json");
  });

  test("entry-only ledger renders just the header line", () => {
    expect(renderReceiptStatus("# nothing yet\n")).toEqual(["[receipt n=0]"]);
  });

  test("oversized ledger truncates to the line cap", () => {
    const big = Array.from({ length: 40 }, (_, i) => `[[job]]\nJ-${i} = "job number ${i}"`).join(
      "\n",
    );
    const lines = renderReceiptStatus(big);
    expect(lines[0]).toBe("[receipt n=0]");
    expect(lines.at(-1)).toBe("…(truncated)");
    expect(lines.length).toBeLessThanOrEqual(31);
  });
});

describe("buildVerifyPrompt", () => {
  test("names the verification gate without extra focus", () => {
    const prompt = buildVerifyPrompt("");
    expect(prompt).toContain("verification gate");
    expect(prompt).not.toContain("Extra focus");
  });

  test("appends user args as extra focus", () => {
    const prompt = buildVerifyPrompt("coverage");
    expect(prompt).toContain("Extra focus from the user: coverage");
  });
});

describe("runRecall", () => {
  test("returns formatted hits from the first search", async () => {
    const pi = new FakePi();
    pi.scripted.push({ stdout: ENGRAM_HIT });
    const text = await runRecall(pi as unknown as ExtensionAPI, "cicd", "omp-plugins");
    expect(text).toContain("remembered fix");
    expect(pi.execCalls).toHaveLength(1);
    expect(pi.execCalls[0]?.args).toContain("cicd");
  });

  test("falls back to recent project context when keywords miss", async () => {
    const pi = new FakePi();
    pi.scripted.push({ stdout: "no memories found\n" }, { stdout: ENGRAM_HIT });
    const text = await runRecall(pi as unknown as ExtensionAPI, "zzz", "omp-plugins");
    expect(text).toContain("remembered fix");
    expect(pi.execCalls).toHaveLength(2);
    expect(pi.execCalls[1]?.args).toContain("omp-plugins");
  });

  test("returns null when both searches are empty", async () => {
    const pi = new FakePi();
    const text = await runRecall(pi as unknown as ExtensionAPI, "zzz", "omp-plugins");
    expect(text).toBeNull();
  });

  test("exec failures propagate to the caller", async () => {
    const pi = new FakePi();
    pi.throwOnExec = true;
    await expect(runRecall(pi as unknown as ExtensionAPI, "x", "omp-plugins")).rejects.toThrow();
  });
});

describe("/receipt handler", () => {
  test("shows the ledger without spending a turn", async () => {
    const cwd = tempDir("cmd-receipt-");
    writeLedger(cwd, LEDGER);
    const notified: Array<[string, string | undefined]> = [];
    await registered().get("receipt")?.handler("", makeCtx(cwd, notified));
    expect(notified).toHaveLength(1);
    expect(notified[0]?.[0]).toContain("job (in progress) F-02");
    expect(notified[0]?.[1]).toBe("info");
  });

  test("missing ledger is an info, not an error", async () => {
    const notified: Array<[string, string | undefined]> = [];
    await registered()
      .get("receipt")
      ?.handler("", makeCtx(tempDir("cmd-noreceipt-"), notified));
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("no job ledger yet");
  });

  test("ledger file with no entries reports empty", async () => {
    const cwd = tempDir("cmd-empty-");
    writeLedger(cwd, "# nothing yet\n");
    const notified: Array<[string, string | undefined]> = [];
    await registered().get("receipt")?.handler("", makeCtx(cwd, notified));
    expect(notified[0]).toEqual(["job ledger is empty", "info"]);
  });

  test("done with no ledger file errors", async () => {
    const notified: Array<[string, string | undefined]> = [];
    await registered()
      .get("receipt")
      ?.handler("done F-01", makeCtx(tempDir("cmd-nodone-"), notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("no job ledger to update");
  });

  test("done flips the job state on disk and confirms", async () => {
    const cwd = tempDir("cmd-done-");
    writeLedger(cwd, LEDGER);
    const notified: Array<[string, string | undefined]> = [];
    await registered().get("receipt")?.handler("done F-02", makeCtx(cwd, notified));
    expect(readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8")).toContain('state = "finished"');
    expect(notified[0]).toEqual(["marked F-02 finished", "info"]);
  });

  test("done on an unknown id errors with the open list", async () => {
    const cwd = tempDir("cmd-unknown-");
    writeLedger(cwd, LEDGER);
    const notified: Array<[string, string | undefined]> = [];
    await registered().get("receipt")?.handler("done F-99", makeCtx(cwd, notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("no job 'F-99'");
    expect(notified[0]?.[0]).toContain("F-02");
  });

  test("done on a finished job is idempotent info", async () => {
    const cwd = tempDir("cmd-redone-");
    writeLedger(cwd, LEDGER);
    const notified: Array<[string, string | undefined]> = [];
    await registered().get("receipt")?.handler("done F-01", makeCtx(cwd, notified));
    expect(notified[0]).toEqual(["F-01 is already finished", "info"]);
  });

  test("done without an id and unknown subcommands show usage", async () => {
    const notified: Array<[string, string | undefined]> = [];
    const ctx = makeCtx(tempDir("cmd-usage-"), notified);
    await registered().get("receipt")?.handler("done", ctx);
    await registered().get("receipt")?.handler("bogus", ctx);
    expect(notified.map((n) => n[0])).toEqual([
      "usage: /receipt done <id>",
      "usage: /receipt [done <id>]",
    ]);
  });
});

describe("/verify handler", () => {
  test("starts a turn with the verification prompt", async () => {
    const pi = new FakePi();
    registerCommands(pi as unknown as ExtensionAPI);
    await pi.commands.get("verify")?.handler("", makeCtx(tempDir("cmd-verify-")));
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("verification gate");
  });

  test("trailing args become extra focus", async () => {
    const pi = new FakePi();
    registerCommands(pi as unknown as ExtensionAPI);
    await pi.commands.get("verify")?.handler("flake hunt", makeCtx(tempDir("cmd-verify-arg-")));
    expect(pi.sentUserMessages[0]).toContain("Extra focus from the user: flake hunt");
  });
});

describe("/recall handler", () => {
  test("surfaces engram hits as info", async () => {
    const pi = new FakePi();
    pi.scripted.push({ stdout: ENGRAM_HIT });
    registerCommands(pi as unknown as ExtensionAPI);
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("recall")?.handler("cicd fix", makeCtx("/repo/proj", notified));
    expect(pi.execCalls[0]?.args).toContain("cicd fix");
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("remembered fix");
  });

  test("empty query shows usage without calling engram", async () => {
    const pi = new FakePi();
    registerCommands(pi as unknown as ExtensionAPI);
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("recall")?.handler("   ", makeCtx("/repo", notified));
    expect(pi.execCalls).toHaveLength(0);
    expect(notified[0]).toEqual(["usage: /recall <keywords>", "error"]);
  });

  test("engram failure warns instead of breaking the loop", async () => {
    const pi = new FakePi();
    pi.throwOnExec = true;
    registerCommands(pi as unknown as ExtensionAPI);
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("recall")?.handler("cicd", makeCtx("/repo", notified));
    expect(notified[0]?.[1]).toBe("warning");
  });

  test("no hits reports the miss", async () => {
    const pi = new FakePi();
    registerCommands(pi as unknown as ExtensionAPI);
    const notified: Array<[string, string | undefined]> = [];
    await pi.commands.get("recall")?.handler("zzz", makeCtx("/repo", notified));
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("no recorded memories match");
  });
});
