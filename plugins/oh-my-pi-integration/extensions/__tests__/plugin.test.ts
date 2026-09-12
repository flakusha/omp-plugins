import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { GIT_DESTRUCTIVE_NOTICE } from "../guards/git-destructive-guard";
import { GPG_BLOCK_REASON } from "../guards/gpg-guard";
import { SSH_BLOCK_REASON } from "../guards/ssh-guard";
import integrationPlugin from "../index";

type Handler = (event: never, ctx: never) => unknown;

// -- type guards for handler results (shapes the plugin contract returns) ----

function contextLines(value: unknown): string[] {
  if (
    value !== null &&
    typeof value === "object" &&
    "context" in value &&
    Array.isArray(value.context)
  ) {
    return value.context.map(String);
  }
  return [];
}

function lastText(value: unknown): string {
  if (value !== null && typeof value === "object" && "content" in value) {
    const content = value.content;
    if (Array.isArray(content)) {
      const last = content.at(-1);
      if (last !== null && typeof last === "object" && "text" in last) {
        return String(last.text);
      }
    }
  }
  return "";
}

function isErrorFlag(value: unknown): boolean {
  return (
    value !== null && typeof value === "object" && "isError" in value && value.isError === true
  );
}

function isBlockFlag(value: unknown): boolean {
  return value !== null && typeof value === "object" && "block" in value && value.block === true;
}

function messageContent(value: unknown): string {
  if (
    value !== null &&
    typeof value === "object" &&
    "message" in value &&
    value.message !== null &&
    typeof value.message === "object" &&
    "content" in value.message
  ) {
    return String(value.message.content);
  }
  return "";
}

function reasonText(value: unknown): string {
  if (value !== null && typeof value === "object" && "reason" in value) {
    return String(value.reason);
  }
  return "";
}
/**
 * Minimal ExtensionAPI double: records registrations and execs, returns
 * per-command scripted stdout (default empty), and can be told to throw for
 * a command to exercise the plugin's best-effort catch paths.
 */
class FakePi {
  handlers = new Map<string, Handler[]>();
  execCalls: Array<{ command: string; args: string[] }> = [];
  scripted = new Map<string, Array<{ stdout?: string }>>();
  throwCommands = new Set<string>();
  labels: string[] = [];
  commands = new Map<string, { description?: string; handler: Handler }>();
  sentUserMessages: string[] = [];

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async exec(command: string, args: string[]): Promise<{ stdout?: string }> {
    this.execCalls.push({ command, args });
    if (this.throwCommands.has(command)) throw new Error("scripted failure");
    const queue = this.scripted.get(command);
    return queue?.shift() ?? { stdout: "" };
  }

  setLabel(label: string): void {
    this.labels.push(label);
  }

  registerCommand(name: string, opts: { description?: string; handler: Handler }): void {
    this.commands.set(name, opts);
  }

  async sendUserMessage(content: string): Promise<void> {
    this.sentUserMessages.push(content);
  }

  script(command: string, responses: Array<{ stdout?: string }>): void {
    this.scripted.set(command, responses);
  }

  /** Run all handlers for an event; resolves async handlers; returns results. */
  async emit(event: string, ev: unknown, ctx: unknown): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const handler of this.handlers.get(event) ?? []) {
      results.push(await handler(ev as never, ctx as never));
    }
    return results;
  }

  engramCalls(): Array<{ command: string; args: string[] }> {
    return this.execCalls.filter((c) => c.command === "engram");
  }
}

// Test-double boundary: the plugin only needs `cwd` + `ui.notify`.
function makeCtx(cwd: string, notified: Array<[string, string]> = []): ExtensionContext {
  return {
    cwd,
    ui: { notify: (message: string, level: string) => notified.push([message, level]) },
  } as unknown as ExtensionContext;
}

function bashCallEvent(command: string): unknown {
  return { type: "tool_call", toolCallId: "t1", toolName: "bash", input: { command } };
}

function bashResultEvent(
  command: string,
  opts: { isError?: boolean; text?: string } = {},
): unknown {
  return {
    type: "tool_result",
    toolCallId: "t1",
    toolName: "bash",
    input: { command },
    content: [{ type: "text", text: opts.text ?? "" }],
    isError: opts.isError ?? false,
    details: undefined,
  };
}

function editResultEvent(path: string): unknown {
  return {
    type: "tool_result",
    toolCallId: "t2",
    toolName: "edit",
    input: { path },
    content: [{ type: "text", text: "ok" }],
    isError: false,
    details: undefined,
  };
}

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
});

describe("integrationPlugin — registration", () => {
  test("registers every handler and the plugin label", () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    expect(pi.handlers.get("tool_call")).toHaveLength(3);
    expect(pi.handlers.get("tool_result")).toHaveLength(5);
    for (const event of [
      "turn_start",
      "turn_end",
      "session_shutdown",
      "session.compacting",
      "before_agent_start",
    ]) {
      expect(pi.handlers.get(event)).toHaveLength(event === "before_agent_start" ? 2 : 1);
    }
    expect(pi.labels).toEqual(["engram-rtk-leanctx"]);
    expect([...pi.commands.keys()].sort()).toEqual([
      "bookkeep",
      "finalize",
      "find-work",
      "recall",
      "receipt",
      "verify",
      "worktree",
      "wt",
    ]);
  });

  test("registers nothing when PI_INTEGRATION_DISABLE=1", () => {
    setEnv("PI_INTEGRATION_DISABLE", "1");
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    expect(pi.handlers.size).toBe(0);
    expect(pi.commands.size).toBe(0);
  });
});

describe("integrationPlugin — tool_call wiring", () => {
  test("rewrites a bare cat through the rtk bridge", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const results = await pi.emit("tool_call", bashCallEvent("cat a.txt"), makeCtx("/repo"));
    const rewritten = results.filter(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        "input" in r &&
        r.input !== null &&
        typeof r.input === "object" &&
        "command" in r.input,
    );
    expect(rewritten).toHaveLength(1);
    const input = (rewritten[0] as { input: { command: string } }).input;
    expect(input.command).toBe("rtk read a.txt");
  });

  test("blocks gpg-agent tampering", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const results = await pi.emit(
      "tool_call",
      bashCallEvent("gpgconf --kill gpg-agent"),
      makeCtx("/repo"),
    );
    const blocked = results.filter(isBlockFlag);
    expect(blocked).toHaveLength(1);
    expect(reasonText(blocked[0])).toBe(GPG_BLOCK_REASON);
  });

  test("blocks ssh-agent tampering", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const results = await pi.emit("tool_call", bashCallEvent("pkill ssh-agent"), makeCtx("/repo"));
    const blocked = results.filter(isBlockFlag);
    expect(blocked).toHaveLength(1);
    expect(reasonText(blocked[0])).toBe(SSH_BLOCK_REASON);
  });

  test("non-bash tool calls pass every handler untouched", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const results = await pi.emit(
      "tool_call",
      { type: "tool_call", toolCallId: "t3", toolName: "read", input: { path: "/etc/hosts" } },
      makeCtx("/repo"),
    );
    expect(results.every((r) => r === undefined)).toBe(true);
  });
});

describe("integrationPlugin — tool_result wiring", () => {
  test("notifies on destructive git commands", async () => {
    const notified: Array<[string, string]> = [];
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    await pi.emit(
      "tool_result",
      bashResultEvent("git reset --hard HEAD~1"),
      makeCtx("/repo", notified),
    );
    expect(notified).toContainEqual([GIT_DESTRUCTIVE_NOTICE, "warning"]);
  });

  test("substitutes a hard-stop directive for a locked-key signing failure", async () => {
    const notified: Array<[string, string]> = [];
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const results = await pi.emit(
      "tool_result",
      bashResultEvent('git commit -m "x"', {
        isError: true,
        text: "error: gpg failed to sign the data",
      }),
      makeCtx("/repo", notified),
    );
    const substituted = results.find(isErrorFlag);
    expect(isErrorFlag(substituted)).toBe(true);
    expect(lastText(substituted)).toContain("GPGSIGN-HARDSTOP");
    expect(lastText(substituted)).toContain("error: gpg failed to sign the data");
    expect(notified.some(([message]) => message.includes("GPG signing failed"))).toBe(true);
  });

  test("leaves unrelated bash errors untouched", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const results = await pi.emit(
      "tool_result",
      bashResultEvent("bun test", { isError: true, text: "1 test failed" }),
      makeCtx("/repo"),
    );
    expect(results.every((r) => r === undefined)).toBe(true);
  });
});

describe("integrationPlugin — memory buffer", () => {
  test("buffers edits, flushes to engram at turn end, and feeds compaction", async () => {
    const ctx = makeCtx("/repo");
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);

    await pi.emit("tool_result", editResultEvent("/repo/src/a.ts"), ctx);
    const compacting = await pi.emit("session.compacting", {}, ctx);
    const context = contextLines(compacting[0]);
    expect(context[0]).toContain("project: repo");
    expect(context.join("\n")).toContain("In-flight work");
    expect(context.join("\n")).toContain("edited /repo/src/a.ts");

    await pi.emit("turn_end", {}, ctx);
    const saves = pi.engramCalls();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.args[0]).toBe("save");
    expect(saves[0]?.args[1]).toContain("work: repo");
    expect(saves[0]?.args[2]).toContain("edited /repo/src/a.ts");

    // buffer drained: compaction no longer lists in-flight work; turn end no-ops
    const drained = await pi.emit("session.compacting", {}, ctx);
    expect(contextLines(drained[0]).join("\n")).not.toContain("In-flight work");
    await pi.emit("turn_end", {}, ctx);
    expect(pi.engramCalls()).toHaveLength(1);
  });

  test("caps the buffer at 8 entries", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    for (let i = 0; i < 10; i += 1) {
      await pi.emit("tool_result", editResultEvent(`/repo/src/f${i}.ts`), makeCtx("/repo"));
    }
    await pi.emit("turn_end", {}, makeCtx("/repo"));
    const saves = pi.engramCalls();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.args[2].split("\n")).toHaveLength(8);
  });

  test("session_shutdown saves a summary with or without buffered work", async () => {
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    await pi.emit("session_shutdown", {}, makeCtx("/my-proj"));
    const saves = pi.engramCalls();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.args[2]).toBe("Session completed.");
    expect(saves[0]?.args).toContain("session_summary");

    const pi2 = new FakePi();
    integrationPlugin(pi2 as unknown as ExtensionAPI);
    await pi2.emit("tool_result", editResultEvent("/my-proj/src/b.ts"), makeCtx("/my-proj"));
    await pi2.emit("session_shutdown", {}, makeCtx("/my-proj"));
    const saves2 = pi2.engramCalls();
    expect(saves2).toHaveLength(1);
    expect(saves2[0]?.args[2]).toContain("Notable actions:");
    expect(saves2[0]?.args).toContain("session_summary");
  });
});

describe("integrationPlugin — lint feedback", () => {
  test("appends formatted diagnostics after a successful TS edit", async () => {
    const cwd = tempDir("plugin-lint-");
    const biomeBin = join(cwd, "node_modules", ".bin", "biome");
    mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
    // resolveBiome only stats the path; a non-executable placeholder suffices
    writeFileSync(biomeBin, "#!/bin/sh\n");

    const pi = new FakePi();
    pi.script(biomeBin, [{ stdout: "src/a.ts:1:1 lint/suspicious/noExplicitAny Unexpected any." }]);
    integrationPlugin(pi as unknown as ExtensionAPI);

    const file = join(cwd, "src", "a.ts");
    const results = await pi.emit("tool_result", editResultEvent(file), makeCtx(cwd));
    const note = results.map(lastText).find((text) => text.length > 0) ?? "";
    expect(note).toContain("[biome]");
    expect(note).toContain("lint/suspicious/noExplicitAny");
  });

  test("stays silent when the file is clean, non-TS, or capped for the turn", async () => {
    const cwd = tempDir("plugin-lint-clean-");
    const biomeBin = join(cwd, "node_modules", ".bin", "biome");
    mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
    writeFileSync(biomeBin, "#!/bin/sh\n");

    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);

    const clean = await pi.emit("tool_result", editResultEvent(join(cwd, "a.ts")), makeCtx(cwd));
    expect(clean.every((r) => r === undefined)).toBe(true);
    const biomeCalls = () => pi.execCalls.filter((c) => c.command === biomeBin);
    expect(biomeCalls()).toHaveLength(1); // clean file: biome ran, empty stdout, no note

    // non-lintable path never reaches biome
    await pi.emit("tool_result", editResultEvent(join(cwd, "a.md")), makeCtx(cwd));
    expect(biomeCalls()).toHaveLength(1);

    // per-turn cap: 4 biome runs max, reset by turn_start
    pi.script(biomeBin, [
      { stdout: "f0.ts:1:1 lint/suspicious/noExplicitAny x" },
      { stdout: "f1.ts:1:1 lint/suspicious/noExplicitAny x" },
      { stdout: "f2.ts:1:1 lint/suspicious/noExplicitAny x" },
      { stdout: "f3.ts:1:1 lint/suspicious/noExplicitAny x" },
      { stdout: "f4.ts:1:1 lint/suspicious/noExplicitAny x" },
    ]);
    for (let i = 0; i < 6; i += 1) {
      await pi.emit("tool_result", editResultEvent(join(cwd, `f${i}.ts`)), makeCtx(cwd));
    }
    expect(biomeCalls()).toHaveLength(4); // clean probe + 3 capped (cap = 4/turn)
    await pi.emit("turn_start", {}, makeCtx(cwd));
    await pi.emit("tool_result", editResultEvent(join(cwd, "after.ts")), makeCtx(cwd));
    expect(biomeCalls()).toHaveLength(5);
  });
});

describe("integrationPlugin — turn-start retrieval", () => {
  test("injects formatted engram hits once per session", async () => {
    setEnv("PI_INTEGRATION_RETRIEVE", "1");
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    pi.script("engram", [
      {
        stdout:
          "Found 1 memories\n[1] #611 (session_summary) — Fixed the widget flak\nwall time: 0.1s",
      },
    ]);
    const ctx = makeCtx("/repo");
    const first = await pi.emit("before_agent_start", { prompt: "fix the widget, flak" }, ctx);
    const content = messageContent(first[0]);
    expect(content).toContain("Fixed the widget flak");
    expect(content).toContain("Prior recorded context");
    expect(pi.engramCalls()[0]?.args[1]).toBe("fix widget flak");

    const second = await pi.emit("before_agent_start", { prompt: "anything else" }, ctx);
    expect(second[0]).toBeUndefined();
    expect(pi.engramCalls()).toHaveLength(1);
  });

  test("falls back to project search, then stays silent when nothing matches", async () => {
    setEnv("PI_INTEGRATION_RETRIEVE", "1");
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    pi.script("engram", [{ stdout: "no memories found" }, { stdout: "" }]);
    const result = await pi.emit(
      "before_agent_start",
      { prompt: "obscure query" },
      makeCtx("/repo"),
    );
    expect(result[0]).toBeUndefined();
    expect(pi.engramCalls()).toHaveLength(2);
    expect(pi.engramCalls()[1]?.args[1]).toBe("repo");
  });

  test("never blocks the turn when engram fails", async () => {
    setEnv("PI_INTEGRATION_RETRIEVE", "1");
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    pi.throwCommands.add("engram");
    const result = await pi.emit("before_agent_start", { prompt: "anything" }, makeCtx("/repo"));
    expect(result[0]).toBeUndefined();
  });

  test("re-retrieves every turn when PI_RETRIEVE_EVERY_TURN=1", async () => {
    setEnv("PI_INTEGRATION_RETRIEVE", "1");
    setEnv("PI_RETRIEVE_EVERY_TURN", "1");
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    pi.script("engram", [
      { stdout: "[1] #1 (observation) — cached the token" },
      { stdout: "" },
      { stdout: "" },
    ]);
    const ctx = makeCtx("/repo");
    await pi.emit("before_agent_start", { prompt: "token stuff" }, ctx);
    await pi.emit("before_agent_start", { prompt: "more" }, ctx);
    expect(pi.engramCalls().length).toBeGreaterThanOrEqual(2);
  });

  test("does nothing without PI_INTEGRATION_RETRIEVE", async () => {
    setEnv("PI_INTEGRATION_RETRIEVE", undefined);
    const pi = new FakePi();
    integrationPlugin(pi as unknown as ExtensionAPI);
    const result = await pi.emit("before_agent_start", { prompt: "anything" }, makeCtx("/repo"));
    expect(result[0]).toBeUndefined();
    expect(pi.execCalls).toHaveLength(0);
  });
});
