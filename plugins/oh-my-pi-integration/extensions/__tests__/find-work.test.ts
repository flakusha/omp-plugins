import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionAskDialogResult,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import type { FindWorkArgs, LabeledTicket, WorkTicket } from "../commands/find-work";
import {
  buildAskQuestions,
  buildChatPrompt,
  buildFindWorkAgentPrompt,
  buildLabelIndex,
  buildSelectedPrompt,
  classifyKind,
  classifyPriority,
  detectWorkSources,
  domainOf,
  fetchTickets,
  filterTickets,
  groupBatches,
  kindFromReceiptId,
  labelTickets,
  letterLabel,
  MAX_TICKETS,
  parseFindWorkArgs,
  parseGhIssues,
  parseGitIssueList,
  planTickets,
  receiptTickets,
  registerFindWork,
  renderList,
  renderTable,
} from "../commands/find-work";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

class FakePi {
  execCalls: Array<{ command: string; args: string[] }> = [];
  scripted: Array<{ stdout?: string }> = [];
  throwOnExec = false;
  sentUserMessages: string[] = [];

  registerCommand(name: string, opts: { description?: string; handler: CommandHandler }): void {
    this.commands.set(name, opts);
  }

  commands = new Map<string, { description?: string; handler: CommandHandler }>();

  async exec(command: string, args: string[]): Promise<{ stdout?: string }> {
    this.execCalls.push({ command, args });
    if (this.throwOnExec) throw new Error("cli down");
    return this.scripted.shift() ?? { stdout: "" };
  }

  async sendUserMessage(content: string): Promise<void> {
    this.sentUserMessages.push(content);
  }
}

type AskDialog = (
  questions: unknown,
  dialogOptions?: { timeout?: number },
) => Promise<ExtensionAskDialogResult | undefined>;

function makeCtx(
  cwd: string,
  notified: Array<[string, string | undefined]>,
  askDialog?: AskDialog,
): ExtensionCommandContext {
  return {
    cwd,
    ui: {
      notify: (message: string, level?: string) => notified.push([message, level]),
      ...(askDialog ? { askDialog } : {}),
    },
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

function ticket(overrides: Partial<WorkTicket> = {}): WorkTicket {
  return {
    id: "#1",
    title: "fix the hook",
    source: "github",
    kind: "bug",
    priority: "P1",
    domain: "github",
    ...overrides,
  };
}

function labeled(overrides: Partial<WorkTicket> = {}, label = "1"): LabeledTicket {
  return { ticket: ticket(overrides), label };
}

const NO_PATH = "/nonexistent-bin";

const GH_JSON = JSON.stringify([
  {
    number: 12,
    title: "fix: hook crash on empty diff",
    labels: [{ name: "bug" }, { name: "P1" }, { name: "runtime" }],
    url: "https://example.test/12",
  },
  {
    number: 13,
    title: "feat: batch finalize",
    labels: [{ name: "enhancement" }],
  },
]);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

describe("parseFindWorkArgs", () => {
  test("empty argv → defaults", () => {
    expect(parseFindWorkArgs([])).toEqual({
      args: { mode: "list", scheme: "order", batches: false, kinds: [], query: "" },
    });
  });

  test("mode, scheme, batches, filters, and directive are separated", () => {
    const { args } = parseFindWorkArgs(["table", "letters", "batches", "bugs", "about hooks"]);
    expect(args).toEqual({
      mode: "table",
      scheme: "letters",
      batches: true,
      kinds: ["bug"],
      query: "about hooks",
    });
  });

  test("list-priorities sugar implies list mode and the scheme", () => {
    expect(parseFindWorkArgs(["list-priorities"]).args).toMatchObject({
      mode: "list",
      scheme: "priorities",
    });
  });

  test("list-bugs sugar adds the bug filter", () => {
    expect(parseFindWorkArgs(["list-bugs"]).args).toMatchObject({ mode: "list", kinds: ["bug"] });
  });

  test("dash-prefixed flags map to bare keywords", () => {
    expect(parseFindWorkArgs(["ask", "--types"]).args).toMatchObject({
      mode: "ask",
      scheme: "types",
    });
  });

  test("mode keyword only counts as the first token — user example keeps ask", () => {
    const { args } = parseFindWorkArgs([
      "ask",
      "List",
      "bug",
      "items",
      "and",
      "propose",
      "next",
      "batch",
      "of",
      "fixes",
    ]);
    expect(args.mode).toBe("ask");
    expect(args.kinds).toEqual([]);
    expect(args.query).toBe("List bug items and propose next batch of fixes");
  });

  test("unknown list-* sugar is an error naming valid variants", () => {
    const { error } = parseFindWorkArgs(["list-wat"]);
    expect(error).toContain("unknown option 'list-wat'");
    expect(error).toContain("list-priorities");
  });

  test("directive starts at the first unrecognized token", () => {
    const { args } = parseFindWorkArgs(["ask", "bugs", "propose a batch"]);
    expect(args).toMatchObject({ mode: "ask", kinds: ["bug"], query: "propose a batch" });
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classification", () => {
  test("kind: labels win, then title prefix, then task", () => {
    expect(classifyKind(["enhancement"], "anything")).toBe("feature");
    expect(classifyKind(["epic"], "x")).toBe("epic");
    expect(classifyKind([], "fix: crash")).toBe("bug");
    expect(classifyKind([], "feat: thing")).toBe("feature");
    expect(classifyKind([], "epic: platform")).toBe("epic");
    expect(classifyKind([], "chore: tidy")).toBe("task");
    expect(classifyKind([], "just words")).toBe("task");
  });

  test("priority: P-label, priority: prefix, severity words, default", () => {
    expect(classifyPriority(["P0"])).toBe("P0");
    expect(classifyPriority(["priority: P2"])).toBe("P2");
    expect(classifyPriority(["critical"])).toBe("P0");
    expect(classifyPriority(["high"])).toBe("P1");
    expect(classifyPriority(["low"])).toBe("P3");
    expect(classifyPriority(["runtime"])).toBe("P3");
    expect(classifyPriority([])).toBe("P3");
  });

  test("domain: first non-kind/priority label, else source fallback", () => {
    expect(domainOf(["bug", "P1", "runtime"], "github")).toBe("runtime");
    expect(domainOf(["bug", "P1"], "github")).toBe("github");
    expect(domainOf([], "git-issue")).toBe("git-issue");
  });

  test("receipt id prefixes hint kinds", () => {
    expect(kindFromReceiptId("B-00")).toBe("bug");
    expect(kindFromReceiptId("F-01")).toBe("feature");
    expect(kindFromReceiptId("E-2")).toBe("epic");
    expect(kindFromReceiptId("I-9")).toBe("task");
    expect(kindFromReceiptId(undefined)).toBe("task");
  });
});

// ---------------------------------------------------------------------------
// Labeling, grouping, rendering
// ---------------------------------------------------------------------------

describe("labelTickets", () => {
  const tickets = [
    ticket({ kind: "bug" }),
    ticket({ kind: "bug" }),
    ticket({ kind: "feature", priority: "P3" }),
    ticket({ kind: "epic", priority: "P0" }),
  ];

  test("order scheme numbers sequentially", () => {
    expect(labelTickets(tickets, "order").map((i) => i.label)).toEqual(["1", "2", "3", "4"]);
  });

  test("letters scheme is bijective base-26 across the Z boundary", () => {
    expect(letterLabel(0)).toBe("A");
    expect(letterLabel(25)).toBe("Z");
    expect(letterLabel(26)).toBe("AA");
    expect(letterLabel(27)).toBe("AB");
    const many = Array.from({ length: 28 }, () => ticket());
    const labels = labelTickets(many, "letters").map((i) => i.label);
    expect(labels[26]).toBe("AA");
    expect(labels[27]).toBe("AB");
  });

  test("priorities scheme uses the ticket priority", () => {
    expect(labelTickets(tickets, "priorities").map((i) => i.label)).toEqual([
      "P1",
      "P1",
      "P3",
      "P0",
    ]);
  });

  test("types scheme counts per kind (B1 B2 F1 E1)", () => {
    expect(labelTickets(tickets, "types").map((i) => i.label)).toEqual(["B1", "B2", "F1", "E1"]);
  });
});

describe("groupBatches", () => {
  test("groups by domain preserving first-appearance order", () => {
    const items = [
      labeled({ domain: "runtime" }, "1"),
      labeled({ domain: "cli" }, "2"),
      labeled({ domain: "runtime" }, "3"),
    ];
    const groups = groupBatches(items);
    expect([...groups.keys()]).toEqual(["runtime", "cli"]);
    expect(groups.get("runtime")?.map((i) => i.label)).toEqual(["1", "3"]);
  });
});

describe("renderers", () => {
  const items = [
    labeled(
      {
        id: "#12",
        title: "fix hook",
        source: "github",
        kind: "bug",
        priority: "P1",
        domain: "runtime",
      },
      "1",
    ),
    labeled(
      {
        id: "F-02",
        title: "improve db",
        source: "receipt",
        kind: "feature",
        priority: "P3",
        domain: "receipt",
      },
      "2",
    ),
  ];

  test("renderList: flat numbered lines with a header", () => {
    expect(renderList(items, false)).toBe(
      [
        "found 2 open work item(s) (sources: github, receipt)",
        "1. #12 — fix hook (github, bug, P1)",
        "2. F-02 — improve db (receipt, feature, P3)",
      ].join("\n"),
    );
  });

  test("renderList batches insert domain section headers", () => {
    const out = renderList(items, true);
    expect(out).toContain("— runtime (1) —");
    expect(out).toContain("— receipt (1) —");
    expect(out.indexOf("— runtime")).toBeLessThan(out.indexOf("— receipt"));
  });

  test("renderTable renders header, separator, and rows", () => {
    expect(renderTable(items, false)).toBe(
      [
        "| label | id | title | source | kind | prio |",
        "|---|---|---|---|---|---|",
        "| 1 | #12 | fix hook | github | bug | P1 |",
        "| 2 | F-02 | improve db | receipt | feature | P3 |",
      ].join("\n"),
    );
  });

  test("renderTable with batches prepends the domain column", () => {
    const out = renderTable(items, true);
    expect(out.split("\n")[0]).toBe("| domain | label | id | title | source | kind | prio |");
    expect(out).toContain("| runtime | 1 | #12 |");
  });

  test("long titles clip with an ellipsis", () => {
    const long = labeled({ title: "x".repeat(100) });
    expect(renderList([long], false).split("\n")[1]).toContain(`${"x".repeat(79)}…`);
  });
});

describe("ask structures", () => {
  const items = [
    labeled({ domain: "runtime", id: "#12", title: "fix hook" }, "1"),
    labeled({ domain: "runtime", id: "#13", title: "fix loop" }, "2"),
    labeled({ domain: "receipt", id: "F-02", title: "improve db" }, "3"),
  ];

  test("buildAskQuestions: one multi question per domain with labeled options", () => {
    const questions = buildAskQuestions(items);
    expect(questions.map((q) => q.header)).toEqual(["runtime", "receipt"]);
    expect(questions[0]?.multi).toBe(true);
    expect(questions[0]?.options.map((o) => o.label)).toEqual([
      "1 #12 — fix hook",
      "2 #13 — fix loop",
    ]);
    expect(questions[0]?.options[0]?.description).toContain("bug, P1 (github)");
  });

  test("buildLabelIndex round-trips selected option labels", () => {
    const index = buildLabelIndex(items);
    expect(index.get("2 #13 — fix loop")?.id).toBe("#13");
    expect(index.get("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sources + fetch layer
// ---------------------------------------------------------------------------

describe("detectWorkSources", () => {
  test("fs surfaces detected from the root, PATH bins from pathEnv", () => {
    const dir = tempDir("fw-detect-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nF-01 = "x"\n');
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    mkdirSync(join(dir, "scripts", "worktree"), { recursive: true });
    writeFileSync(join(dir, "scripts", "worktree", "gi.ts"), "");
    const bin = tempDir("fw-bin-");
    writeFileSync(join(bin, "gh"), "");
    const sources = detectWorkSources(dir, bin);
    expect(sources).toEqual({
      receipt: true,
      plan: true,
      gh: true,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: true,
    });
  });

  test("empty environment has no sources", () => {
    const sources = detectWorkSources(tempDir("fw-empty-"), NO_PATH);
    expect(hasAllFalse(sources)).toBe(true);
  });

  function hasAllFalse(sources: Record<string, boolean>): boolean {
    return Object.values(sources).every((v) => v === false);
  }
});

describe("receiptTickets", () => {
  test("open jobs become tickets with id-prefix kinds; finished jobs skipped", () => {
    const dir = tempDir("fw-receipt-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(
      join(dir, ".omp", "receipt.toml"),
      '[[job]]\nF-01 = "make the cicd happy"\nstate = "finished"\n[[job]]\nB-02 = "fix the crash"\n',
    );
    const tickets = receiptTickets(dir);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      id: "B-02",
      title: "fix the crash",
      source: "receipt",
      kind: "bug",
      domain: "receipt",
    });
  });

  test("missing ledger yields nothing", () => {
    expect(receiptTickets(tempDir("fw-noreceipt-"))).toEqual([]);
  });
});

describe("planTickets", () => {
  test("headings become titles, done statuses are skipped, epics dir hints kind", () => {
    const dir = tempDir("fw-plan-");
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    mkdirSync(join(dir, ".plan", "epics"), { recursive: true });
    writeFileSync(join(dir, ".plan", "tickets", "T-1.md"), "# Fix the parser\nStatus: open\n");
    writeFileSync(join(dir, ".plan", "tickets", "T-2.md"), "# Already done\nStatus: done\n");
    writeFileSync(join(dir, ".plan", "tickets", "notes.txt"), "ignored");
    writeFileSync(join(dir, ".plan", "epics", "E-9.md"), "no heading here\n");
    const tickets = planTickets(dir);
    expect(tickets.map((t) => t.id).sort()).toEqual(["E-9", "T-1"]);
    const t1 = tickets.find((t) => t.id === "T-1");
    expect(t1).toMatchObject({ title: "Fix the parser", source: ".plan", domain: "tickets" });
    const e9 = tickets.find((t) => t.id === "E-9");
    expect(e9).toMatchObject({ title: "E-9", kind: "epic", domain: "epics" });
  });

  test("missing .plan dir yields nothing", () => {
    expect(planTickets(tempDir("fw-noplan-"))).toEqual([]);
  });
});

describe("CLI output parsers", () => {
  test("parseGhIssues maps labels to kind, priority, and domain", () => {
    const tickets = parseGhIssues(GH_JSON);
    expect(tickets[0]).toMatchObject({
      id: "#12",
      title: "fix: hook crash on empty diff",
      kind: "bug",
      priority: "P1",
      domain: "runtime",
    });
    expect(tickets[1]).toMatchObject({
      id: "#13",
      kind: "feature",
      priority: "P3",
      domain: "github",
    });
  });

  test("parseGhIssues throws on invalid JSON (caller warns)", () => {
    expect(() => parseGhIssues("not json")).toThrow();
  });

  test("parseGitIssueList handles numbered list lines and skips noise", () => {
    const tickets = parseGitIssueList("1. first issue\n2 second issue\n\nnoise line\n");
    expect(tickets.map((t) => `${t.id} ${t.title}`)).toEqual([
      "GI-1 first issue",
      "GI-2 second issue",
    ]);
  });
});

describe("fetchTickets", () => {
  test("combines fs sources and gh; cli failures degrade to warnings", async () => {
    const dir = tempDir("fw-fetch-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nF-01 = "ledger job"\n');
    const pi = new FakePi();
    pi.scripted.push({ stdout: GH_JSON }); // gh call
    const { tickets, warnings } = await fetchTickets(pi, dir, {
      receipt: true,
      plan: false,
      gh: true,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: false,
    });
    expect(tickets.map((t) => t.id)).toEqual(["F-01", "#12", "#13"]);
    expect(warnings).toEqual([]);
    expect(pi.execCalls[0]?.args).toEqual([
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "30",
      "--json",
      "number,title,labels,url",
    ]);
  });

  test("exec failures produce warnings, other sources still contribute", async () => {
    const pi = new FakePi();
    pi.throwOnExec = true;
    const { tickets, warnings } = await fetchTickets(pi, tempDir("fw-fail-"), {
      receipt: false,
      plan: false,
      gh: true,
      gitIssue: true,
      jira: false,
      glab: false,
      trackerCli: true,
    });
    expect(tickets).toEqual([]);
    expect(warnings.some((w) => w.includes("gh issue list failed"))).toBe(true);
    expect(warnings.some((w) => w.includes("git-issue list failed"))).toBe(true);
    expect(warnings.some((w) => w.includes("worktree tracker CLI"))).toBe(true);
  });

  test("results cap at MAX_TICKETS with a truncation warning", async () => {
    const many = Array.from({ length: MAX_TICKETS + 5 }, (_, i) => ticket({ id: `#${i}` }));
    const pi = new FakePi();
    pi.scripted.push({ stdout: JSON.stringify(many) });
    const { tickets, warnings } = await fetchTickets(pi, tempDir("fw-cap-"), {
      receipt: false,
      plan: false,
      gh: true,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: false,
    });
    expect(tickets).toHaveLength(MAX_TICKETS);
    expect(warnings.join("\n")).toContain(
      `showing first ${MAX_TICKETS} of ${MAX_TICKETS + 5} items`,
    );
  });
});

// ---------------------------------------------------------------------------
// Filters + prompts
// ---------------------------------------------------------------------------

describe("filterTickets", () => {
  const tickets = [
    ticket({ id: "#12", title: "fix hook", kind: "bug" }),
    ticket({ id: "F-2", title: "add feature", kind: "feature" }),
  ];
  const base: FindWorkArgs = {
    mode: "list",
    scheme: "order",
    batches: false,
    kinds: [],
    query: "",
  };

  test("no filters passes everything", () => {
    expect(filterTickets(tickets, base)).toHaveLength(2);
  });

  test("kind filter and query substring combine", () => {
    expect(filterTickets(tickets, { ...base, kinds: ["bug"] })).toHaveLength(1);
    expect(filterTickets(tickets, { ...base, query: "HOOK" })).toHaveLength(1);
    expect(filterTickets(tickets, { ...base, query: "missing" })).toHaveLength(0);
    expect(filterTickets(tickets, { ...base, kinds: ["bug"], query: "add feature" })).toHaveLength(
      0,
    );
  });
});

describe("prompt builders", () => {
  const items = [labeled({ id: "#12", title: "fix hook" }, "1")];

  test("buildSelectedPrompt lists the batch and the directive", () => {
    const out = buildSelectedPrompt([items[0]?.ticket ?? ticket()], "do it now");
    expect(out).toContain("Work batch selected via /find-work:");
    expect(out).toContain("- [P1 #12] fix hook (github)");
    expect(out).toContain("User directive: do it now");
  });

  test("buildSelectedPrompt without directive falls back to priority-order work", () => {
    expect(buildSelectedPrompt([], "")).toContain("priority order");
  });

  test("buildChatPrompt carries the directive and the item list", () => {
    const out = buildChatPrompt(items, "why this order");
    expect(out).toContain("The user wants to discuss: why this order");
    expect(out).toContain("1. #12 — fix hook");
  });

  test("buildFindWorkAgentPrompt names detected sources and directive", () => {
    const out = buildFindWorkAgentPrompt(
      "/repo",
      {
        receipt: false,
        plan: true,
        gh: true,
        gitIssue: false,
        jira: true,
        glab: false,
        trackerCli: false,
      },
      "list bug items",
    );
    expect(out).toContain("/repo");
    expect(out).toContain("gh yes");
    expect(out).toContain("User directive: list bug items");
    expect(out).toContain("ask tool");
  });
});

// ---------------------------------------------------------------------------
// Handler flows
// ---------------------------------------------------------------------------

describe("/find-work handler", () => {
  /** Run the handler with CLI bins off PATH so detection is deterministic. */
  async function run(pi: FakePi, args: string, ctx: ExtensionCommandContext): Promise<void> {
    const realPath = process.env.PATH;
    process.env.PATH = NO_PATH;
    try {
      await pi.commands.get("find-work")?.handler(args, ctx);
    } finally {
      process.env.PATH = realPath;
    }
  }

  function registered(): Map<string, { description?: string; handler: CommandHandler }> {
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    return pi.commands;
  }

  test("list mode renders without spending a turn", async () => {
    const dir = tempDir("fw-h-list-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "", makeCtx(dir, notified));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[0]).toContain("1. B-01 — fix the crash (receipt, bug, P3)");
    expect(notified[0]?.[1]).toBe("info");
  });

  test("list-bugs sugar filters to bug tickets", async () => {
    const dir = tempDir("fw-h-bugs-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(
      join(dir, ".omp", "receipt.toml"),
      '[[job]]\nB-01 = "fix the crash"\n[[job]]\nF-01 = "add export"\n',
    );
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "list-bugs", makeCtx(dir, notified));
    expect(notified[0]?.[0]).toContain("B-01");
    expect(notified[0]?.[0]).not.toContain("F-01");
  });

  test("query filter miss reports the miss", async () => {
    const dir = tempDir("fw-h-miss-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "nosuchthing", makeCtx(dir, notified));
    expect(notified[0]).toEqual(["no open work items found matching 'nosuchthing'", "info"]);
  });

  test("unknown list-* sugar errors without fetching", async () => {
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "list-wat", makeCtx(tempDir("fw-h-wat-"), notified));
    expect(notified[0]?.[1]).toBe("error");
    expect(pi.execCalls).toHaveLength(0);
  });

  test("no sources and no args prints usage info", async () => {
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "", makeCtx(tempDir("fw-h-usage-"), notified));
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("usage:");
    expect(notified[0]?.[0]).toContain("sources: receipt no");
  });

  test("ask mode with askDialog: submit sends the selected batch turn", async () => {
    const dir = tempDir("fw-h-ask-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const notified: Array<[string, string | undefined]> = [];
    let askedQuestions: unknown;
    const askDialog: AskDialog = async (questions) => {
      askedQuestions = questions;
      const first = (questions as Array<{ options: Array<{ label: string }> }>)[0];
      return {
        kind: "submit",
        results: [
          {
            id: "receipt",
            question: "q",
            options: [],
            multi: true,
            selectedOptions: [first?.options[0]?.label ?? ""],
          },
        ],
      };
    };
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask propose fixes", makeCtx(dir, notified, askDialog));
    expect(askedQuestions).toBeDefined();
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("[P3 B-01] fix the crash");
    expect(pi.sentUserMessages[0]).toContain("User directive: propose fixes");
  });

  test("ask mode chat result sends the discussion turn", async () => {
    const dir = tempDir("fw-h-chat-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const askDialog: AskDialog = async () => ({ kind: "chat" });
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask", makeCtx(dir, [], askDialog));
    expect(pi.sentUserMessages[0]).toContain("The user wants to discuss these tickets.");
  });

  test("ask mode cancel notifies without a turn", async () => {
    const dir = tempDir("fw-h-cancel-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const notified: Array<[string, string | undefined]> = [];
    const askDialog: AskDialog = async () => undefined;
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask", makeCtx(dir, notified, askDialog));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]).toEqual(["find-work: cancelled", "info"]);
  });

  test("ask mode without askDialog falls back to the agent-search turn", async () => {
    const dir = tempDir("fw-h-noask-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask", makeCtx(dir, []));
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("Present the result with the ask tool");
  });

  test("ask with zero fetched tickets falls back to the agent-search turn", async () => {
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask find anything", makeCtx(tempDir("fw-h-emptyask-"), notified));
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("User directive: find anything");
    expect(notified).toHaveLength(0);
  });

  test("unknown dialog selection reports no selection", async () => {
    const dir = tempDir("fw-h-badsel-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const notified: Array<[string, string | undefined]> = [];
    const askDialog: AskDialog = async () => ({
      kind: "submit",
      results: [
        {
          id: "receipt",
          question: "q",
          options: [],
          multi: true,
          selectedOptions: ["ghost option"],
        },
      ],
    });
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask", makeCtx(dir, notified, askDialog));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]).toEqual(["find-work: no tickets selected", "info"]);
  });

  test("description is a non-empty usage string", () => {
    const commands = registered();
    expect(commands.get("find-work")?.description).toContain("/find-work [list|table|ask]");
  });
});
