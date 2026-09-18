import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  buildTicketExec,
  buildTicketFallbackPrompt,
  detectTicketEnv,
  kebabTicketTitle,
  type ParsedTicket,
  parseTicketArgs,
  parseTicketExec,
  registerTicket,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  ticketCompletions,
  ticketUsage,
} from "../commands/ticket";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

interface Scripted {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

class FakePi {
  commands = new Map<
    string,
    {
      description?: string;
      handler: CommandHandler;
      getArgumentCompletions?: (arg: string) => Array<{ value: string; label: string }>;
    }
  >();
  execCalls: Array<{ command: string; args: string[] }> = [];
  scripted: Scripted[] = [];
  throwOnExec = false;
  sentUserMessages: string[] = [];

  registerCommand(
    name: string,
    opts: {
      description?: string;
      handler: CommandHandler;
      getArgumentCompletions?: (arg: string) => Array<{ value: string; label: string }>;
    },
  ): void {
    this.commands.set(name, opts);
  }

  async exec(command: string, args: string[]): Promise<Scripted> {
    this.execCalls.push({ command, args });
    if (this.throwOnExec) throw new Error("giwt down");
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

function ticketCmd(): {
  pi: FakePi;
  handler: CommandHandler;
  completions?: (arg: string) => Array<{ value: string; label: string }>;
} {
  const pi = new FakePi();
  registerTicket(pi as unknown as ExtensionAPI);
  const cmd = pi.commands.get("ticket");
  if (!cmd) throw new Error("ticket command not registered");
  return { pi, handler: cmd.handler, completions: cmd.getArgumentCompletions };
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

function scaffoldPlanIds(root: string): void {
  mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
  mkdirSync(join(root, ".plan", "epics"), { recursive: true });
  writeFileSync(
    join(root, ".plan/tickets/FEAT-login-flow.md"),
    "# FEAT: login\n\n**Status:** Not Started\n",
  );
  writeFileSync(
    join(root, ".plan/epics/EPIC-ship.md"),
    "# EPIC: ship\n\n**Status:** In Progress\n",
  );
}

function scaffoldGiwt(root: string): void {
  mkdirSync(join(root, ".tmp", "giwt"), { recursive: true });
}

describe("detectTicketEnv", () => {
  test("empty dir has no giwt and default tickets dir", () => {
    const root = tempDir("tkt-empty-");
    const env = detectTicketEnv(root);
    expect(env.root).toBe(root);
    expect(env.giwtAvailable).toBe(false);
    expect(env.ticketsDir).toBe(join(root, ".plan/tickets"));
    expect(env.existingIds).toEqual([]);
  });

  test("undefined cwd falls back to process cwd", () => {
    expect(detectTicketEnv(undefined).root).toBe(process.cwd());
  });

  test("giwt.toml marks giwt available with a custom tickets dir", () => {
    const root = tempDir("tkt-toml-");
    writeFileSync(join(root, "giwt.toml"), '[paths]\ntickets = ".plan/tix"\n');
    const env = detectTicketEnv(root);
    expect(env.giwtAvailable).toBe(true);
    expect(env.ticketsDir).toBe(join(root, ".plan/tix"));
  });

  test("discovers existing planning ids", () => {
    const root = tempDir("tkt-ids-");
    scaffoldPlanIds(root);
    expect(detectTicketEnv(root).existingIds.sort()).toEqual(["EPIC-ship", "FEAT-login-flow"]);
  });
});

describe("kebabTicketTitle", () => {
  test("lowercases and hyphenates", () => {
    expect(kebabTicketTitle("Add Login Flow!")).toBe("add-login-flow");
  });

  test("trims dashes and collapses separators", () => {
    expect(kebabTicketTitle("  Trim---Me  ")).toBe("trim-me");
  });
});

describe("parseTicketArgs", () => {
  test("empty and help are the help mode", () => {
    expect(parseTicketArgs([]).mode).toBe("help");
    expect(parseTicketArgs(["help"]).mode).toBe("help");
  });

  test("list is the list mode", () => {
    expect(parseTicketArgs(["list"]).mode).toBe("list");
  });

  test("loose requires a title", () => {
    const parsed = parseTicketArgs(["loose"]);
    expect(parsed.mode).toBe("loose");
    expect(parsed.error).toContain("requires a title");
  });

  test("loose parses title, body, and flags", () => {
    const parsed = parseTicketArgs([
      "loose",
      "Quick note",
      "more detail",
      "--label",
      "ui",
      "--priority",
      "high",
    ]);
    expect(parsed.mode).toBe("loose");
    expect(parsed.type).toBeNull();
    expect(parsed.title).toBe("Quick note");
    expect(parsed.body).toBe("more detail");
    expect(parsed.labels).toEqual(["ui"]);
    expect(parsed.priority).toBe("high");
  });

  test("loose flag without a value errors", () => {
    expect(parseTicketArgs(["loose", "T", "--label"]).error).toContain("requires a value");
  });

  test("loose rejects an unknown priority", () => {
    expect(parseTicketArgs(["loose", "T", "--priority", "urgent"]).error).toContain(
      "invalid priority",
    );
  });

  test("unknown ticket type errors with the valid set", () => {
    const parsed = parseTicketArgs(["BOGUS", "T"]);
    expect(parsed.error).toContain("unknown ticket type");
    expect(parsed.error).toContain("BUG");
  });

  test("strict parses type, title, body, and every flag", () => {
    const parsed = parseTicketArgs([
      "FEAT",
      "Add x",
      "does y",
      "--label",
      "a",
      "--label",
      "b",
      "--priority",
      "low",
      "--epic",
      "EPIC-1",
      "--effort",
      "M",
    ]);
    expect(parsed.mode).toBe("strict");
    expect(parsed.type).toBe("FEAT");
    expect(parsed.title).toBe("Add x");
    expect(parsed.body).toBe("does y");
    expect(parsed.labels).toEqual(["a", "b"]);
    expect(parsed.priority).toBe("low");
    expect(parsed.epic).toBe("EPIC-1");
    expect(parsed.effort).toBe("M");
    expect(parsed.error).toBeUndefined();
  });

  test("type matching is case-insensitive and body joins positionals", () => {
    const parsed = parseTicketArgs(["feat", "X", "on launch", "at noon"]);
    expect(parsed.type).toBe("FEAT");
    expect(parsed.body).toBe("on launch at noon");
  });

  test("strict flag without a value errors", () => {
    expect(parseTicketArgs(["BUG", "T", "--epic"]).error).toContain("requires a value");
  });

  test("strict rejects an unknown priority", () => {
    expect(parseTicketArgs(["BUG", "T", "--priority", "now"]).error).toContain("invalid priority");
  });

  test("strict without a title leaves title null; words split title/body", () => {
    const parsed = parseTicketArgs(["TASK"]);
    expect(parsed.type).toBe("TASK");
    expect(parsed.title).toBeNull();
    const split = parseTicketArgs(["FEAT", "Add", "thing"]);
    expect(split.title).toBe("Add");
    expect(split.body).toBe("thing");
  });

  test("type and priority vocabularies", () => {
    expect(TICKET_TYPES).toContain("BUG");
    expect(TICKET_PRIORITIES).toContain("high");
  });
});

describe("buildTicketExec", () => {
  test("strict ticket becomes the giwt argv", () => {
    const parsed = parseTicketArgs([
      "FEAT",
      "Add x",
      "does y",
      "--label",
      "a",
      "--priority",
      "high",
      "--epic",
      "E",
      "--effort",
      "S",
    ]);
    expect(buildTicketExec(parsed)).toEqual([
      "ticket",
      "FEAT",
      "Add x",
      "does y",
      "--label",
      "a",
      "--priority",
      "high",
      "--epic",
      "E",
      "--effort",
      "S",
    ]);
  });

  test("loose defaults the type to TASK", () => {
    expect(buildTicketExec(parseTicketArgs(["loose", "Quick note"]))).toEqual([
      "ticket",
      "TASK",
      "Quick note",
    ]);
  });

  test("typeless strict builds the bare subcommand", () => {
    const parsed: ParsedTicket = { type: null, mode: "strict", title: null, body: "", labels: [] };
    expect(buildTicketExec(parsed)).toEqual(["ticket"]);
  });
});

describe("parseTicketExec", () => {
  test("exit 0 extracts file and issue", () => {
    const res = parseTicketExec({
      stdout: "Created\nFile: .plan/tickets/FEAT-x.md\nIssue: abc1234\n",
      stderr: "",
      exitCode: 0,
    });
    expect(res.ok).toBe(true);
    expect(res.file).toBe(".plan/tickets/FEAT-x.md");
    expect(res.issue).toBe("abc1234");
  });

  test("exit 0 without markers keeps the trimmed summary", () => {
    const res = parseTicketExec({ stdout: "  done\n", stderr: "", exitCode: 0 });
    expect(res.ok).toBe(true);
    expect(res.summary).toBe("done");
    expect(res.file).toBeUndefined();
  });

  test("nonzero exit prefers stderr", () => {
    const res = parseTicketExec({ stdout: "out", stderr: "boom", exitCode: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });

  test("nonzero exit falls back to stdout when stderr is empty", () => {
    const res = parseTicketExec({ stdout: "nope", stderr: "", exitCode: 2 });
    expect(res.error).toBe("nope");
  });
});

describe("ticketUsage", () => {
  test("usage names the form, giwt state, and existing ids", () => {
    const root = tempDir("tkt-usage-");
    scaffoldPlanIds(root);
    scaffoldGiwt(root);
    const usage = ticketUsage(detectTicketEnv(root));
    expect(usage).toContain("/ticket <TYPE>");
    expect(usage).toContain("giwt: yes");
    expect(usage).toContain(join(root, ".plan/tickets"));
    expect(usage).toContain("FEAT-login-flow");
  });

  test("usage without giwt or ids reports none", () => {
    const usage = ticketUsage(detectTicketEnv(tempDir("tkt-usage0-")));
    expect(usage).toContain("giwt: no");
    expect(usage).toContain("existing tickets: 0 (none)");
  });
});

describe("buildTicketFallbackPrompt", () => {
  test("strict ticket bakes stem, scaffold, and metadata", () => {
    const root = tempDir("tkt-fb-");
    const env = detectTicketEnv(root);
    const prompt = buildTicketFallbackPrompt(
      env,
      parseTicketArgs([
        "FEAT",
        "Add thing",
        "Does stuff",
        "--label",
        "ui",
        "--priority",
        "high",
        "--epic",
        "EPIC-1",
        "--effort",
        "S",
      ]),
    );
    expect(prompt).toContain(join(root, ".plan/tickets/FEAT-add-thing.md"));
    expect(prompt).toContain("**Status:** Not Started");
    expect(prompt).toContain("**Labels:** ui");
    expect(prompt).toContain("**Priority:** high");
    expect(prompt).toContain("**Epic:** EPIC-1");
    expect(prompt).toContain("**Effort:** S");
    expect(prompt).toContain("Does stuff");
  });

  test("missing fields fall back to unset markers", () => {
    const env = detectTicketEnv(tempDir("tkt-fb0-"));
    const prompt = buildTicketFallbackPrompt(env, {
      type: null,
      mode: "loose",
      title: null,
      body: "",
      labels: [],
    });
    expect(prompt).toContain("TASK-untitled.md");
    expect(prompt).toContain("(none)");
    expect(prompt).toContain("(unset)");
    expect(prompt).toContain("No description.");
  });
});

describe("ticketCompletions", () => {
  test("empty prefix offers types and shortcuts", () => {
    const items = ticketCompletions(detectTicketEnv(tempDir("tkt-cmp-")), "");
    expect(items).toContain("BUG");
    expect(items).toContain("loose");
    expect(items).toContain("list");
    expect(items).toContain("help");
  });

  test("partial prefix narrows the type set", () => {
    expect(ticketCompletions(detectTicketEnv(tempDir("tkt-cmp1-")), "F")).toEqual([
      "FEAT",
      "FIX",
      "INFRA",
    ]);
  });

  test("list and help take no further completions", () => {
    const env = detectTicketEnv(tempDir("tkt-cmp2-"));
    expect(ticketCompletions(env, "list")).toEqual([]);
    expect(ticketCompletions(env, "help me")).toEqual([]);
  });

  test("bare --priority completes the priority values", () => {
    const items = ticketCompletions(detectTicketEnv(tempDir("tkt-cmp3-")), "BUG T --priority");
    expect(items).toEqual([...TICKET_PRIORITIES]);
  });

  test("--epic prefix narrows to epic ids and empty value lists flags", () => {
    const root = tempDir("tkt-cmp4-");
    scaffoldPlanIds(root);
    const env = detectTicketEnv(root);
    // "BUG --epic" (no trailing space): last token is the partial flag → value candidates.
    expect(ticketCompletions(env, "BUG --epic")).toEqual([]);
    // "BUG T --epic " (trailing space): empty next token → flag hints, none match "".
    expect(ticketCompletions(env, "BUG T --epic ")).toEqual([
      "--label",
      "--priority",
      "--epic",
      "--effort",
    ]);
    expect(ticketCompletions(env, "BUG T --epic EP")).toEqual(["--epic"]);
    // No epic whose id contains the last token → empty.
    expect(ticketCompletions(env, "BUG T --zzz")).toEqual([]);
  });

  test("partial flag text suggests flag hints", () => {
    const env = detectTicketEnv(tempDir("tkt-cmp5-"));
    expect(ticketCompletions(env, "BUG Fix crash --la")).toEqual(["--label"]);
    expect(ticketCompletions(env, "BUG T --epic EP")).toEqual(["--epic"]);
  });
});

describe("ticket handler", () => {
  test("registers with a description and working completions", () => {
    const { pi, completions } = ticketCmd();
    expect(pi.commands.get("ticket")?.description).toBeString();
    const labels = (completions?.("") ?? []).map((item) => item.label);
    expect(labels).toContain("BUG");
  });

  test("bare invoke shows usage without spending a turn", async () => {
    const { pi, handler } = ticketCmd();
    const notified: Array<[string, string | undefined]> = [];
    await handler("", makeCtx(tempDir("tkt-hbare-"), notified));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(pi.execCalls).toHaveLength(0);
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("/ticket <TYPE>");
  });

  test("unknown type errors with usage", async () => {
    const { handler } = ticketCmd();
    const notified: Array<[string, string | undefined]> = [];
    await handler("BOGUS x", makeCtx(tempDir("tkt-hbad-"), notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("unknown ticket type");
  });

  test("loose without a title errors", async () => {
    const { handler } = ticketCmd();
    const notified: Array<[string, string | undefined]> = [];
    await handler("loose", makeCtx(tempDir("tkt-hloose0-"), notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("requires a title");
  });

  test("help shows usage", async () => {
    const { handler } = ticketCmd();
    const notified: Array<[string, string | undefined]> = [];
    await handler("help", makeCtx(tempDir("tkt-hhelp-"), notified));
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("/ticket <TYPE>");
  });

  test("list reports the count, empty or seeded", async () => {
    const { handler } = ticketCmd();
    const emptyNotified: Array<[string, string | undefined]> = [];
    await handler("list", makeCtx(tempDir("tkt-hlist0-"), emptyNotified));
    expect(emptyNotified[0]?.[0]).toContain("existing tickets: 0 (none)");
    const root = tempDir("tkt-hlist-");
    scaffoldPlanIds(root);
    const notified: Array<[string, string | undefined]> = [];
    await handler("list", makeCtx(root, notified));
    expect(notified[0]?.[0]).toContain("FEAT-login-flow");
  });

  test("strict without a title errors", async () => {
    const { handler } = ticketCmd();
    const notified: Array<[string, string | undefined]> = [];
    await handler("TASK", makeCtx(tempDir("tkt-htitle-"), notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("missing title");
  });

  test("valid ticket without giwt starts the file turn", async () => {
    const { pi, handler } = ticketCmd();
    const root = tempDir("tkt-hfb-");
    // Unquoted handler args split on whitespace: "Add thing" → title "Add", body "thing".
    await handler("FEAT Add thing", makeCtx(root));
    expect(pi.execCalls).toHaveLength(0);
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("No giwt detected");
    expect(pi.sentUserMessages[0]).toContain("FEAT-add.md");
  });

  test("giwt success notifies file and issue", async () => {
    const { pi, handler } = ticketCmd();
    const root = tempDir("tkt-hok-");
    scaffoldGiwt(root);
    pi.scripted.push({
      stdout: "Created\nFile: .plan/tickets/FEAT-x.md\nIssue: abc1234\n",
      stderr: "",
      exitCode: 0,
    });
    const notified: Array<[string, string | undefined]> = [];
    await handler("FEAT X", makeCtx(root, notified));
    expect(pi.execCalls[0]).toEqual({ command: "giwt", args: ["ticket", "FEAT", "X"] });
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("File: .plan/tickets/FEAT-x.md");
    expect(notified[0]?.[0]).toContain("Issue: abc1234");
  });

  test("giwt nonzero exit notifies the failure", async () => {
    const { pi, handler } = ticketCmd();
    const root = tempDir("tkt-hfail-");
    scaffoldGiwt(root);
    pi.scripted.push({ stdout: "", stderr: "boom", exitCode: 1 });
    const notified: Array<[string, string | undefined]> = [];
    await handler("BUG crash", makeCtx(root, notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("exit 1");
    expect(notified[0]?.[0]).toContain("boom");
  });

  test("giwt exec failure notifies instead of breaking", async () => {
    const { pi, handler } = ticketCmd();
    const root = tempDir("tkt-hdown-");
    scaffoldGiwt(root);
    pi.throwOnExec = true;
    const notified: Array<[string, string | undefined]> = [];
    await handler("BUG crash", makeCtx(root, notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(notified[0]?.[0]).toContain("giwt ticket failed");
  });
});
