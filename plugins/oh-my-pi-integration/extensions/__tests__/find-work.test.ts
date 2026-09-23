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
  buildOrchestratePrompt,
  buildSelectedPrompt,
  classifyKind,
  classifyPriority,
  type DoctorCheck,
  detectLintTool,
  detectWorkSources,
  domainOf,
  fetchMergeTickets,
  fetchTickets,
  fetchToolTickets,
  filterTickets,
  giwtLedgerTickets,
  giwtRunTickets,
  groupBatches,
  hasGitRepo,
  hasJscpd,
  hasKnip,
  hasTestScript,
  hasTodoSource,
  kindFromReceiptId,
  labelTickets,
  letterLabel,
  MAX_TICKETS,
  mapDoctorReport,
  parseBiomeOutput,
  parseBranchLines,
  parseDoctorReport,
  parseEslintJson,
  parseFindWorkArgs,
  parseGhIssues,
  parseGitIssueList,
  parseJscpdReport,
  parseKnipIssues,
  parseMergeBase,
  parseOxlintJson,
  parseRevCounts,
  parseStatusShort,
  parseTestOutput,
  parseTscOutput,
  parseWorktreePorcelain,
  planTickets,
  receiptTickets,
  registerFindWork,
  renderList,
  renderTable,
  todoCommentText,
  todoTickets,
} from "../commands/find-work";
import { readPlanLabels } from "../util/plan-frontmatter";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

class FakePi {
  execCalls: Array<{ command: string; args: string[] }> = [];
  scripted: Array<{ stdout?: string }> = [];
  throwOnExec = false;
  /** Substrings of `command + args` that fail (selective exec failure). */
  throwMatching: string[] = [];
  sentUserMessages: string[] = [];

  registerCommand(name: string, opts: { description?: string; handler: CommandHandler }): void {
    this.commands.set(name, opts);
  }

  commands = new Map<string, { description?: string; handler: CommandHandler }>();

  async exec(command: string, args: string[]): Promise<{ stdout?: string }> {
    this.execCalls.push({ command, args });
    if (
      this.throwOnExec ||
      this.throwMatching.some((p) => `${command} ${args.join(" ")}`.includes(p))
    ) {
      throw new Error("cli down");
    }
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

  // Parser sugar surface stays in lock-step with FIND_WORK_SUGAR / error
  // message: invented or near-miss suffixes (list-bug, list-task, ...) reject
  // everywhere, not just at position 0, so users don't get silent near-misses.
  test.each([
    "list-bug",
    "list-feat",
    "list-task",
    "list-epic",
    "list-feature",
    "list-priority",
    "list-type",
    "list-alpha",
    "list-orders",
    "list-bugz",
  ])("non-canonical sugar %s errors at any position", (sugar) => {
    expect(parseFindWorkArgs([sugar]).error).toMatch(/^unknown option 'list-/);
    expect(parseFindWorkArgs(["ask", sugar]).error).toMatch(/^unknown option 'list-/);
    expect(parseFindWorkArgs(["ask", sugar, "directive text"]).error).toMatch(
      /^unknown option 'list-/,
    );
  });

  test("error text enumerates the canonical sugar variants", () => {
    const { error } = parseFindWorkArgs(["list-wat"]);
    for (const s of [
      "list-order",
      "list-letters",
      "list-priorities",
      "list-types",
      "list-batches",
      "list-bugs",
      "list-features",
      "list-epics",
      "list-tasks",
    ]) {
      expect(error).toContain(s);
    }
  });

  test("canonical sugar like list-bugs still accepts sugar plus trailing filter", () => {
    expect(parseFindWorkArgs(["list-bugs"]).args).toMatchObject({
      mode: "list",
      kinds: ["bug"],
    });
    expect(parseFindWorkArgs(["list-bugs", "feature"]).args).toMatchObject({
      mode: "list",
      kinds: ["bug", "feature"],
    });
  });

  test("list- (empty suffix) is a directive, not a sugar", () => {
    // `.+` in LIST_SUGAR_RE rejects empty suffix; bare `list-` quietly
    // becomes directive text — matches existing parseFindWorkArgs behaviour
    // for non-keyword tokens. Captured so a future regex change is loud.
    const { args, error } = parseFindWorkArgs(["list-"]);
    expect(error).toBeUndefined();
    expect(args.mode).toBe("list");
    expect(args.query).toBe("list-");
  });

  test("list-priorities sugar mid-line keeps the leading ask mode", () => {
    const { args } = parseFindWorkArgs(["ask", "list-priorities"]);
    expect(args).toMatchObject({ mode: "ask", scheme: "priorities" });
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
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: false,
      patches: false,
      lint: false,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
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

  test("bold **Status:** lines are recognized and filtered like plain ones", () => {
    const dir = tempDir("fw-plan-bold-");
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    writeFileSync(
      join(dir, ".plan", "tickets", "B-1.md"),
      "# Bold open\n**Status:** In Progress\n",
    );
    writeFileSync(join(dir, ".plan", "tickets", "B-2.md"), "# Bold done\n**Status:** done\n");
    const ids = planTickets(dir).map((t) => t.id);
    expect(ids).toContain("B-1");
    expect(ids).not.toContain("B-2");
  });

  test("bold **Status**: with colon outside bold is recognized and filtered", () => {
    // Repo ticket format (loop-lore): the markdown bold closes BEFORE the
    // colon. Regression: STATUS_LINE_RE used to miss it entirely, so done
    // tickets leaked into /find-work.
    const dir = tempDir("fw-plan-bold-colon-out-");
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    writeFileSync(
      join(dir, ".plan", "tickets", "C-1.md"),
      "# Open colon-out\n**Status**: In Progress\n",
    );
    writeFileSync(join(dir, ".plan", "tickets", "C-2.md"), "# Done colon-out\n**Status**: done\n");
    const ids = planTickets(dir).map((t) => t.id);
    expect(ids).toContain("C-1");
    expect(ids).not.toContain("C-2");
  });

  test("fixed / not-a-bug / won't fix lead statuses terminal; negated + prose stay open", () => {
    // FW-03 regression: loop-lore `**Status**: fixed-in-worktree` and
    // `✅ Fixed (commit …)` tickets leaked; `fixed` was missing entirely.
    const dir = tempDir("fw-plan-fixed-");
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    writeFileSync(
      join(dir, ".plan", "tickets", "B-3.md"),
      "# Fixed in worktree\n**Status**: fixed-in-worktree\n",
    );
    writeFileSync(join(dir, ".plan", "tickets", "B-4.md"), "# Not a bug\n**Status**: not-a-bug\n");
    writeFileSync(join(dir, ".plan", "tickets", "B-6.md"), "# Declined\n**Status**: won't fix\n");
    writeFileSync(
      join(dir, ".plan", "tickets", "B-7.md"),
      "# Fixed with emoji\n**Status**: ✅ Fixed (ccac5b9d server)\n",
    );
    writeFileSync(
      join(dir, ".plan", "tickets", "B-8.md"),
      "# Fixed with ok tag\n**Status**: [OK] Fixed (f32d0a45)\n",
    );
    // Traps: negated word forms and the word `fixed` inside prose must stay.
    writeFileSync(
      join(dir, ".plan", "tickets", "B-5.md"),
      "# Still open\n**Status**: not-yet-implemented\n",
    );
    writeFileSync(
      join(dir, ".plan", "tickets", "B-9.md"),
      "# In progress prose\n**Status**: 🔄 In Progress (converges fixed by backfill later)\n",
    );
    const ids = planTickets(dir).map((t) => t.id);
    expect(ids).toEqual(["B-5", "B-9"]);
  });
  test("multiple status lines: ANY done-looking line closes the ticket", () => {
    // BUG-find-work-closed-epic-reconciliation-stubs-leak-into-roster:
    // reconciled EPIC stubs carry a legacy `**Status:** Not Started → closed
    // (duplicate)` line plus a follow-up `**Status**: duplicate-of-…`; the
    // first-match parser saw only the legacy line and leaked the ticket.
    const dir = tempDir("fw-plan-multistatus-");
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    writeFileSync(
      join(dir, ".plan", "tickets", "E-30.md"),
      "# Dup stub\n**Status:** Not Started → closed (duplicate)\n\n## Notes\n**Status**: duplicate-of-epic-llm-queue\n",
    );
    writeFileSync(
      join(dir, ".plan", "tickets", "E-58.md"),
      "# Dup stub 2\n**Status:** Not Started\n**Status**: duplicate-of-epic-locations\n",
    );
    // A genuinely open ticket with an in-prose mention of done wording on a
    // LATER line must NOT be closed by that later line (legacy line wins as
    // open only when no other line is done-looking).
    writeFileSync(
      join(dir, ".plan", "tickets", "E-59.md"),
      "# Real work\n**Status:** In Progress\nrelated: duplicate-of-epic-frontend-admin needs splitting\n",
    );
    const ids = planTickets(dir).map((t) => t.id);
    expect(ids).toEqual(["E-59"]);
  });
  test("missing .plan dir yields nothing", () => {
    expect(planTickets(tempDir("fw-noplan-"))).toEqual([]);
  });
  test("labels from frontmatter/Labels/Tags headers drive kind, priority, domain", () => {
    const dir = tempDir("fw-plan-labels-");
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    mkdirSync(join(dir, ".plan", "epics"), { recursive: true });
    writeFileSync(
      join(dir, ".plan", "tickets", "L-1.md"),
      "---\nlabels: [bug, p1, crypto]\n---\n# Frontmatter labels\n",
    );
    writeFileSync(
      join(dir, ".plan", "tickets", "L-2.md"),
      "# Header labels\n**Labels:** enhancement, chat\n",
    );
    writeFileSync(join(dir, ".plan", "tickets", "L-3.md"), "# Tags alias\n**Tags:** bug\n");
    writeFileSync(
      join(dir, ".plan", "tickets", "L-4.md"),
      "---\nlabels: [p0, crypto]\n---\n# Precedence\n**Labels:** bug\n",
    );
    writeFileSync(join(dir, ".plan", "epics", "L-5.md"), "# Epic labels\n**Labels:** chat, bug\n");
    writeFileSync(
      join(dir, ".plan", "tickets", "L-6.md"),
      "---\nlabels: [bug, done]\n---\n# Labeled but done\nStatus: done\n",
    );
    const tickets = planTickets(dir);
    const byId: Record<string, WorkTicket | undefined> = {};
    for (const ticket of tickets) byId[ticket.id] = ticket;
    expect(byId["L-1"]).toMatchObject({ kind: "bug", priority: "P1", domain: "crypto" });
    expect(byId["L-2"]).toMatchObject({ kind: "feature", domain: "chat" });
    expect(byId["L-3"]).toMatchObject({ kind: "bug" });
    // frontmatter wins over header (explicit > inherited)
    expect(byId["L-4"]).toMatchObject({ kind: "task", priority: "P0", domain: "crypto" });
    // epic dir default yields only when labels give no stronger kind
    expect(byId["L-5"]).toMatchObject({ kind: "bug" });
    expect(byId["L-6"]).toBeUndefined(); // labels never bypass done-detection
  });
});

describe("readPlanLabels", () => {
  test("flow, bare, block, and quoted frontmatter forms", () => {
    expect(readPlanLabels("---\nlabels: [a, b]\n---\n# t\n")).toEqual(["a", "b"]);
    expect(readPlanLabels("---\nlabels: bug\n---\n# t\n")).toEqual(["bug"]);
    expect(readPlanLabels("---\nlabels:\n  - x\n  - 'y z'\n---\n# t\n")).toEqual(["x", "y z"]);
    expect(readPlanLabels("---\nlabels: []\n---\n# t\n")).toEqual([]);
    expect(readPlanLabels("# no labels\n")).toEqual([]);
  });
  test("Labels outranks Tags regardless of file order", () => {
    expect(readPlanLabels("**Tags:** stale\n**Labels:** fresh\n")).toEqual(["fresh"]);
    expect(readPlanLabels("**Tags:** only\n")).toEqual(["only"]);
    expect(readPlanLabels("---\nlabels: [fm]\n---\n**Tags:** ignored\n")).toEqual(["fm"]);
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

  test("parseGitIssueList classifies TYPE-id prefix in <hash> [state] <TYPE-id>: title", () => {
    // Real `git-issue ls` output shape; before the fix, the
    // captured `title` started at `[open]` and the BUG-/FEAT-/TASK- prefix went
    // unrecognised (the shared NUMBERED_LINE_RE also rejects hex hashes, so
    // the whole body fell through), so every kind was `task` and `kinds=[bug]`
    // filtered empty.
    const stdout = [
      "0674395 [open] TASK-actor-position-physical-vs-spatial-split: split",
      "06cc3fb [open] BUG-server-host-config-dead: start.ts never passes hostname",
      "9203dc7 [open] FEAT-inventory-management-ui: UI",
      "",
    ].join("\n");
    const tickets = parseGitIssueList(stdout);
    expect(tickets.map((t) => [t.id, t.kind, t.title])).toEqual([
      ["GI-0674395", "task", "TASK-actor-position-physical-vs-spatial-split: split"],
      ["GI-06cc3fb", "bug", "BUG-server-host-config-dead: start.ts never passes hostname"],
      ["GI-9203dc7", "feature", "FEAT-inventory-management-ui: UI"],
    ]);
  });

  test("filterTickets(?, bugs) keeps git-issue tickets classified as bug", () => {
    // Regression: assemble what fetchTickets returns from `git-issue ls` on
    // loop-lore (1233+ open issues), confirm kinds=[bug] keeps every BUG- row.
    const stdout = [
      "0674395 [open] TASK-foo: foo",
      "06cc3fb [open] BUG-server-host-dead: dead",
      "9203dc7 [open] FEAT-inventory: ui",
      "9999fff [open] BUG-assets-serve-x-content-type: sniff",
      "",
    ].join("\n");
    const tickets = parseGitIssueList(stdout);
    const bugs = filterTickets(tickets, {
      mode: "list",
      scheme: "order",
      batches: false,
      kinds: ["bug"],
      query: "",
    });
    expect(bugs.map((t) => t.id)).toEqual(["GI-06cc3fb", "GI-9999fff"]);
  });

  test("parseGitIssueList skips [closed] issues but keeps [open]", () => {
    // Regression: `git-issue ls --state all` returns every issue regardless of state; the
    // consumer must filter closed ones or they surface as work items even after
    // the git-issue has been transitioned to closed via `giwt state <id> closed`.
    const stdout = [
      "6ed8545 [closed] EPIC-030: LLM Request Throughput & Message Scheduling",
      "136d857 [closed] EPIC-031: World & Locations",
      "8c07e16 [open]   EPIC-2026-23: Assistant Commands",
      "96970f5 [open]   EPIC-2026-24: Filtering & Pagination",
      "",
    ].join("\n");
    const tickets = parseGitIssueList(stdout);
    expect(tickets.map((t) => t.id)).toEqual(["GI-8c07e16", "GI-96970f5"]);
  });
});

describe("planTickets done-status coverage", () => {
  test("planTickets skips tickets with status: duplicate-of-*", () => {
    // Regression: stub tickets closed via `Status: duplicate-of-epic-...`
    // must NOT surface as work items even when git-issue was closed via
    // `giwt state <id> closed`. The `.plan/tickets/*.md` frontmatter is the
    // source of truth here.
    const dir = tempDir("fw-plan-dup-");
    const ticketsDir = join(dir, ".plan", "tickets");
    mkdirSync(ticketsDir, { recursive: true });
    writeFileSync(
      join(ticketsDir, "EPIC-stub-open.md"),
      "# EPIC-stub-open: live epic\n\n**Status**: open\n",
    );
    writeFileSync(
      join(ticketsDir, "EPIC-stub-dup.md"),
      "# EPIC-stub-dup: duplicate epic\n\n**Status**: duplicate-of-epic-llm-queue\n",
    );
    writeFileSync(
      join(ticketsDir, "EPIC-stub-done.md"),
      "# EPIC-stub-done: done epic\n\n**Status**: ✅ Closed\n",
    );
    const tickets = planTickets(dir);
    expect(tickets.map((t) => t.id).sort()).toEqual(["EPIC-stub-open"]);
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
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: false,
      lint: false,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
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
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: false,
      lint: false,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
    });
    expect(tickets).toEqual([]);
    expect(warnings.some((w) => w.includes("gh issue list failed"))).toBe(true);
    expect(warnings.some((w) => w.includes("git-issue ls failed"))).toBe(true);
    expect(warnings.some((w) => w.includes("worktree tracker CLI"))).toBe(true);
  });

  test("fetchTickets returns uncapped results without a truncation warning", async () => {
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
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: false,
      lint: false,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
    });
    expect(tickets).toHaveLength(MAX_TICKETS + 5);
    expect(warnings).toHaveLength(0);
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
        giwtLedger: false,
        giwtRuns: false,
        todo: false,
        merges: false,
        lint: false,
        typecheck: false,
        tests: false,
        knip: false,
        jscpd: false,
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
    expect(notified[0]?.[0]).toContain("no open items match 'find anything'");
  });

  test("ask mode filters dialog candidates by the query (FW-04)", async () => {
    const dir = tempDir("fw-h-asktopic-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(
      join(dir, ".omp", "receipt.toml"),
      '[[job]]\nB-01 = "fix the crash"\n\n[[job]]\nC-01 = "characters page layout"\n',
    );
    let askedLabels: string[] = [];
    const askDialog: AskDialog = async (questions) => {
      askedLabels = (questions as Array<{ options: Array<{ label: string }> }>).flatMap((q) =>
        q.options.map((o) => o.label),
      );
      return undefined;
    };
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask characters", makeCtx(dir, notified, askDialog));
    expect(askedLabels).toHaveLength(1);
    expect(askedLabels[0]).toContain("characters page layout");
    expect(askedLabels[0]).not.toContain("fix the crash");
    expect(notified[0]).toEqual(["find-work: cancelled", "info"]);
  });

  test("ask mode with a directive that matches nothing keeps the dialog, unfiltered", async () => {
    const dir = tempDir("fw-h-askprose-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    writeFileSync(join(dir, ".omp", "receipt.toml"), '[[job]]\nB-01 = "fix the crash"\n');
    const askDialog: AskDialog = async () => undefined;
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask propose fixes", makeCtx(dir, notified, askDialog));
    expect(notified[0]?.[0]).toContain("no open items match 'propose fixes'");
    expect(pi.sentUserMessages).toHaveLength(0); // cancelled dialog -> no turn
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
    expect(commands.get("find-work")?.description).toContain(
      "/find-work [list|table|ask|orchestrate]",
    );
  });

  test("list mode truncates after filtering with an accurate warning", async () => {
    const dir = tempDir("fw-h-cap-");
    mkdirSync(join(dir, ".omp"), { recursive: true });
    const jobs = Array.from(
      { length: MAX_TICKETS + 5 },
      (_, i) => `[[job]]\nB-${String(i).padStart(2, "0")} = "fix thing ${i}"\n`,
    ).join("");
    writeFileSync(join(dir, ".omp", "receipt.toml"), jobs);
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "", makeCtx(dir, notified));
    expect(notified[0]).toEqual([
      `showing first ${MAX_TICKETS} of ${MAX_TICKETS + 5} matching items`,
      "warning",
    ]);
    expect(notified[1]?.[0]).toContain(`found ${MAX_TICKETS} open work item(s)`);
  });

  test("ask bugs surfaces filtered bugs beyond the raw cap instead of the agent fallback", async () => {
    const dir = tempDir("fw-h-askbugs-");
    const ticketsDir = join(dir, ".plan", "tickets");
    mkdirSync(ticketsDir, { recursive: true });
    for (let i = 0; i < MAX_TICKETS + 5; i++) {
      writeFileSync(
        join(ticketsDir, `FEAT-${String(i).padStart(3, "0")}.md`),
        `# FEAT: filler ${i}\n`,
      );
    }
    writeFileSync(join(ticketsDir, "BUG-real-crash.md"), "# BUG: real crash\n\n**Status**: open\n");
    writeFileSync(join(ticketsDir, "BUG-other-crash.md"), "# BUG: other crash\n");
    let askedQuestions: unknown;
    const askDialog: AskDialog = async (questions) => {
      askedQuestions = questions;
      return undefined;
    };
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "ask bugs", makeCtx(dir, [], askDialog));
    // Pre-fix regression: the raw first-40 slice was fs-order (all FEAT here),
    // so the bug filter emptied the list and ask mode fell back to the
    // agent-search turn instead of showing a dialog.
    expect(askedQuestions).toBeDefined();
    const qs = askedQuestions as Array<{ options: Array<{ label: string }> }>;
    const labels = qs.flatMap((q) => q.options.map((o) => o.label));
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.includes("BUG-"))).toBe(true);
    expect(pi.sentUserMessages).toHaveLength(0);
  });

  test("plan scan is name-sorted so truncation samples deterministically", async () => {
    const dir = tempDir("fw-h-sort-");
    const ticketsDir = join(dir, ".plan", "tickets");
    mkdirSync(ticketsDir, { recursive: true });
    for (const name of ["TASK-zeta", "TASK-alpha", "TASK-mid"]) {
      writeFileSync(join(ticketsDir, `${name}.md`), `# ${name.replace("-", " ")}\n`);
    }
    const notified: Array<[string, string | undefined]> = [];
    const pi = new FakePi();
    registerFindWork(pi as unknown as ExtensionAPI);
    await run(pi, "", makeCtx(dir, notified));
    const out = notified[0]?.[0] ?? "";
    expect(out.indexOf("1. TASK-alpha")).toBeGreaterThan(-1);
    expect(out.indexOf("2. TASK-mid")).toBeGreaterThan(out.indexOf("1. TASK-alpha"));
    expect(out.indexOf("3. TASK-zeta")).toBeGreaterThan(out.indexOf("2. TASK-mid"));
  });
});

describe("giwtLedgerTickets", () => {
  test("returns [] when giwt unavailable (no giwt.toml)", () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-giwt-noleg-"));
    try {
      expect(giwtLedgerTickets(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps ledger entries to work tickets with say-annotation priority", () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-giwt-leg-"));
    try {
      mkdirSync(join(dir, "tree"), { recursive: true });
      mkdirSync(join(dir, ".tmp", "giwt"), { recursive: true });
      writeFileSync(join(dir, "giwt.toml"), '[paths]\ntree = "tree"\n');
      const records = [
        JSON.stringify({
          v: 1,
          ts: "2026-09-10T06:55:01Z",
          pid: 1,
          cmd: "new",
          branch: "auth",
          msg: "new auth :: fixing login",
        }),
        JSON.stringify({
          v: 1,
          ts: "2026-09-10T07:00:00Z",
          pid: 2,
          cmd: "commit",
          branch: "auth",
          msg: "commit auth",
        }),
      ];
      writeFileSync(join(dir, "tree", ".ledger.jsonl"), `${records.join("\n")}\n`);
      const tickets = giwtLedgerTickets(dir);
      expect(tickets.length).toBe(2);
      // Say-annotated record gets P2, bare record gets P3
      const sayTicket = tickets.find(
        (t) => t.msg?.includes("fixing login") || t.title.includes("fixing login"),
      );
      expect(sayTicket).toBeDefined();
      expect(sayTicket?.priority).toBe("P2");
      expect(sayTicket?.source).toBe("giwt-ledger");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("giwtRunTickets", () => {
  test("returns [] when giwt unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-giwt-noruns-"));
    try {
      expect(giwtRunTickets(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("only surfaces abnormal runs (no end/exitCode)", () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-giwt-runs-"));
    try {
      mkdirSync(join(dir, ".tmp", "giwt"), { recursive: true });
      writeFileSync(join(dir, "giwt.toml"), "[paths]\n");
      const runsDir = join(dir, ".tmp", "giwt", "runs");
      mkdirSync(join(runsDir, "20260910-1000-111-finalize"), { recursive: true });
      // Abnormal: no end/exitCode
      writeFileSync(
        join(runsDir, "20260910-1000-111-finalize", "meta.json"),
        JSON.stringify({
          v: 1,
          cmd: "finalize",
          args: ["mybranch"],
          branch: "mybranch",
          repoRoot: dir,
          pid: 111,
          start: "2026-09-10T10:00:00Z",
        }),
      );
      mkdirSync(join(runsDir, "20260910-1100-222-commit"), { recursive: true });
      // Normal: has end and exitCode
      writeFileSync(
        join(runsDir, "20260910-1100-222-commit", "meta.json"),
        JSON.stringify({
          v: 1,
          cmd: "commit",
          args: [],
          branch: "",
          repoRoot: dir,
          pid: 222,
          start: "2026-09-10T11:00:00Z",
          end: "2026-09-10T11:01:00Z",
          exitCode: 0,
        }),
      );
      const tickets = giwtRunTickets(dir);
      expect(tickets.length).toBe(1);
      expect(tickets[0].cmd ?? tickets[0].title).toContain("finalize");
      expect(tickets[0].kind).toBe("bug");
      expect(tickets[0].priority).toBe("P1");
      expect(tickets[0].source).toBe("giwt-run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildOrchestratePrompt", () => {
  test("includes domain grouping and subagent instructions", () => {
    const tickets: WorkTicket[] = [
      {
        id: "B-01",
        title: "fix crash",
        source: "receipt",
        kind: "bug",
        priority: "P0",
        domain: "receipt",
      },
      {
        id: "F-01",
        title: "add feature",
        source: ".plan",
        kind: "feature",
        priority: "P2",
        domain: "auth",
      },
    ];
    const labeled = labelTickets(tickets, "order");
    const sources = detectWorkSources(".", "/nonexistent");
    const prompt = buildOrchestratePrompt(labeled, sources, "");
    expect(prompt).toContain("Orchestrate work items");
    expect(prompt).toContain("Dependency analysis");
    expect(prompt).toContain("Parallel execution");
    expect(prompt).toContain("subagent");
    expect(prompt).toContain("receipt");
    expect(prompt).toContain("auth");
  });

  test("includes user directive when provided", () => {
    const tickets: WorkTicket[] = [
      { id: "T-01", title: "task", source: ".plan", kind: "task", priority: "P3", domain: "test" },
    ];
    const labeled = labelTickets(tickets, "order");
    const sources = detectWorkSources(".", "/nonexistent");
    const prompt = buildOrchestratePrompt(labeled, sources, "focus on auth bugs");
    expect(prompt).toContain("focus on auth bugs");
  });
});

// ---------------------------------------------------------------------------
// TODO comment scan
// ---------------------------------------------------------------------------

describe("todoCommentText", () => {
  test("strips marker and separators", () => {
    expect(todoCommentText("// TODO: refactor this", "TODO")).toBe("refactor this");
    expect(todoCommentText("# FIXME - broken edge", "FIXME")).toBe("broken edge");
    expect(todoCommentText("x = 1  # TODO", "TODO")).toBe("");
  });
});

describe("todoTickets", () => {
  test("FIXME sorts first as bug/P2, TODO follows as task/P3", () => {
    const dir = tempDir("fw-todo-");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "a.ts"),
      "// header\n// TODO: write tests\nconst x = 1;\n// FIXME: off-by-one\nconst y = 2;\n// TODO: more tests\n",
    );
    writeFileSync(join(dir, "src", "b.ts"), "// TODO: document b\n");
    // Skipped: vendored deps, scratch dirs, markdown docs
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "dep", "b.ts"), "// TODO: hidden\n");
    mkdirSync(join(dir, ".tmp"), { recursive: true });
    writeFileSync(join(dir, ".tmp", "c.ts"), "// TODO: scratch\n");
    writeFileSync(join(dir, "notes.md"), "# TODO: document\n");
    const tickets = todoTickets(dir);
    expect(tickets).toHaveLength(4);
    expect(tickets[0]?.id).toBe("TD-01");
    expect(tickets[0]?.kind).toBe("bug");
    expect(tickets[0]?.priority).toBe("P2");
    expect(tickets[0]?.source).toBe("todo");
    expect(tickets[0]?.title).toContain("FIXME");
    expect(tickets[0]?.title).toContain("src/a.ts:4");
    expect(tickets[1]?.kind).toBe("task");
    expect(tickets[1]?.title).toContain("src/a.ts:2");
    expect(tickets[2]?.title).toContain("src/a.ts:6");
    expect(tickets[3]?.title).toContain("src/b.ts:1");
    expect(tickets[0]?.domain).toBe("src");
  });

  test("empty and oversized lines are skipped", () => {
    const dir = tempDir("fw-todo-edge-");
    writeFileSync(join(dir, "ok.ts"), "const x = 1;\n");
    writeFileSync(join(dir, "big.ts"), `// TODO: ${"x".repeat(600)}\n`);
    expect(todoTickets(dir)).toEqual([]);
  });

  test("markers outside comments and inside test files are skipped", () => {
    const dir = tempDir("fw-todo-prec-");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "a.ts"),
      'const m = x === "FIXME" ? "FIXME" : "TODO";\n// TODO: real work\n// TODO\n// TODO: x\n',
    );
    writeFileSync(join(dir, "src", "a.test.ts"), "// TODO: scaffold\n");
    mkdirSync(join(dir, "__tests__"), { recursive: true });
    writeFileSync(join(dir, "__tests__", "b.ts"), "// TODO: fixture\n");
    const tickets = todoTickets(dir);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.title).toContain("real work");
  });
});

describe("hasTodoSource", () => {
  test("true with code files, false for docs-only or empty dirs", () => {
    const code = tempDir("fw-todosrc-");
    writeFileSync(join(code, "a.ts"), "const x = 1;\n");
    expect(hasTodoSource(code)).toBe(true);
    const docs = tempDir("fw-tododocs-");
    writeFileSync(join(docs, "README.md"), "# hi\n");
    expect(hasTodoSource(docs)).toBe(false);
    expect(hasTodoSource(tempDir("fw-todoempty-"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merge queue parsers
// ---------------------------------------------------------------------------

describe("merge parsers", () => {
  test("parseBranchLines rejoins piped subjects", () => {
    const out = parseBranchLines(
      "feat-x|abc123|Add x|2026-09-01\nfeat-y|def456|a|b|c|2026-09-02\n",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: "feat-x", sha: "abc123", subject: "Add x", date: "2026-09-01" });
    expect(out[1]?.subject).toBe("a|b|c");
  });

  test("parseBranchLines tolerates pipes inside branch names", () => {
    const out = parseBranchLines("feat|y|def456|ship it|2026-09-02\n");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      name: "feat|y",
      sha: "def456",
      subject: "ship it",
      date: "2026-09-02",
    });
  });

  test("parseRevCounts reads behind/ahead pair", () => {
    expect(parseRevCounts("3\t5\n")).toEqual({ behind: 3, ahead: 5 });
    expect(parseRevCounts("oops")).toBeNull();
  });

  test("parseMergeBase extracts branch from origin HEAD", () => {
    expect(parseMergeBase("refs/remotes/origin/dev\n")).toBe("dev");
    expect(parseMergeBase("")).toBeNull();
  });

  test("parseWorktreePorcelain handles branch, detached, bare, and prunable blocks", () => {
    const raw = [
      "worktree /r",
      "HEAD aaa",
      "branch refs/heads/dev",
      "",
      "worktree /r/tree/x",
      "HEAD bbb",
      "detached",
      "",
      "worktree /r/tree/y",
      "HEAD ccc",
      "branch refs/heads/feat",
      "bare",
      "",
      "worktree /r/tree/old",
      "HEAD ddd",
      "branch refs/heads/old",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    const out = parseWorktreePorcelain(raw);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      path: "/r",
      head: "aaa",
      branch: "dev",
      bare: false,
      detached: false,
      prunable: null,
    });
    expect(out[1]?.branch).toBeNull();
    expect(out[1]?.detached).toBe(true);
    expect(out[2]?.bare).toBe(true);
    expect(out[3]?.prunable).toBe("gitdir file points to non-existent location");
  });

  test("parseStatusShort counts modified vs untracked", () => {
    expect(parseStatusShort(" M a\nA  b\n?? c\n")).toEqual({ modified: 2, untracked: 1, total: 3 });
    expect(parseStatusShort("")).toEqual({ modified: 0, untracked: 0, total: 0 });
  });
});

describe("fetchMergeTickets", () => {
  test("unmerged branches and dirty worktrees become tickets; protected filtered", async () => {
    const pi = new FakePi();
    const root = tempDir("fw-merge-");
    pi.scripted.push(
      { stdout: "refs/remotes/origin/dev\n" }, // symbolic-ref
      { stdout: "feat-x|abc123|Add x|2026-09-01\nmain|def456|Release|2026-09-02\n" }, // branch list
      { stdout: "1\t2\n" }, // rev-list feat-x
      {
        stdout: [
          `worktree ${root}`,
          "HEAD aaa",
          "branch refs/heads/dev",
          "",
          `worktree ${join(root, "tree", "feat-y")}`,
          "HEAD bbb",
          "branch refs/heads/feat-y",
          "",
          `worktree ${join(root, "tree", "old")}`,
          "HEAD ccc",
          "branch refs/heads/old",
          "prunable gitdir file points to non-existent location",
          "",
        ].join("\n"),
      }, // worktree list
      { stdout: "" }, // status: root clean
      { stdout: " M src/a.ts\n?? scratch.txt\n" }, // status: feat-y dirty
    );
    const tickets = await fetchMergeTickets(pi, root);
    expect(tickets.map((t) => t.id)).toEqual(["WT-feat-y", "WT-old", "feat-x"]);
    const wt = tickets[0];
    expect(wt?.priority).toBe("P1");
    expect(wt?.domain).toBe("worktrees");
    expect(wt?.title).toContain("1 modified, 1 untracked");
    expect(tickets[1]?.priority).toBe("P3");
    expect(tickets[1]?.title).toContain("prunable worktree");
    expect(tickets[1]?.title).toContain("git worktree prune");
    const br = tickets[2];
    expect(br?.priority).toBe("P2");
    expect(br?.domain).toBe("branches");
    expect(br?.title).toContain("2 ahead, 1 behind");
  });

  test("falls back to local dev branch and skips uncountable branches", async () => {
    const pi = new FakePi();
    const root = tempDir("fw-mergefb-");
    pi.scripted.push(
      { stdout: "" }, // symbolic-ref empty → probe locals
      { stdout: "  dev\n" }, // branch --list dev
      { stdout: "gone|a1b2c3d|Gone|2026-01-01\nlive|e4f5a6b|Live|2026-02-02\n" },
      { stdout: "oops" }, // rev-list gone → unparseable, skipped
      { stdout: "0\t1\n" }, // rev-list live
      { stdout: [`worktree ${root}`, "HEAD aaa", "branch refs/heads/dev", ""].join("\n") },
      { stdout: "" }, // clean
    );
    const tickets = await fetchMergeTickets(pi, root);
    expect(tickets.map((t) => t.id)).toEqual(["live"]);
  });
});

// ---------------------------------------------------------------------------
// Tool cluster detection + parsers
// ---------------------------------------------------------------------------

describe("tool detection", () => {
  test("detectLintTool prefers eslint, then biome, then oxlint", () => {
    const dir = tempDir("fw-lintdet-");
    expect(detectLintTool(dir)).toBeNull();
    writeFileSync(join(dir, ".oxlintrc.json"), "{}\n");
    expect(detectLintTool(dir)).toBe("oxlint");
    writeFileSync(join(dir, "biome.json"), "{}\n");
    expect(detectLintTool(dir)).toBe("biome");
    writeFileSync(join(dir, "eslint.config.js"), "export default [];\n");
    expect(detectLintTool(dir)).toBe("eslint");
  });

  test("detectLintTool finds oxlint via package.json dep or script", () => {
    const dep = tempDir("fw-lintoxdep-");
    writeFileSync(join(dep, "package.json"), JSON.stringify({ devDependencies: { oxlint: "^1" } }));
    expect(detectLintTool(dep)).toBe("oxlint");
    const scr = tempDir("fw-lintoxscr-");
    writeFileSync(join(scr, "package.json"), JSON.stringify({ scripts: { oxlint: "oxlint src" } }));
    expect(detectLintTool(scr)).toBe("oxlint");
  });

  test("hasTestScript reads package.json scripts", () => {
    const dir = tempDir("fw-testdet-");
    expect(hasTestScript(dir)).toBe(false);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    expect(hasTestScript(dir)).toBe(true);
  });

  test("hasKnip via config, package key, or dep", () => {
    const cfg = tempDir("fw-knipcfg-");
    writeFileSync(join(cfg, "knip.json"), "{}\n");
    expect(hasKnip(cfg)).toBe(true);
    const key = tempDir("fw-knipkey-");
    writeFileSync(join(key, "package.json"), JSON.stringify({ knip: {} }));
    expect(hasKnip(key)).toBe(true);
    const dep = tempDir("fw-knipdep-");
    writeFileSync(join(dep, "package.json"), JSON.stringify({ devDependencies: { knip: "^5" } }));
    expect(hasKnip(dep)).toBe(true);
    expect(hasKnip(tempDir("fw-knipno-"))).toBe(false);
  });

  test("hasJscpd via config, dep, or script", () => {
    const cfg = tempDir("fw-jscfg-");
    writeFileSync(join(cfg, ".jscpd.json"), "{}\n");
    expect(hasJscpd(cfg)).toBe(true);
    const scr = tempDir("fw-jsscr-");
    writeFileSync(join(scr, "package.json"), JSON.stringify({ scripts: { dup: "jscpd src" } }));
    expect(hasJscpd(scr)).toBe(true);
    expect(hasJscpd(tempDir("fw-jsno-"))).toBe(false);
  });

  test("hasGitRepo checks .git presence", () => {
    const dir = tempDir("fw-gitrepo-");
    expect(hasGitRepo(dir)).toBe(false);
    mkdirSync(join(dir, ".git"));
    expect(hasGitRepo(dir)).toBe(true);
  });
});

describe("tool parsers", () => {
  test("parseEslintJson maps severity to bug/task", () => {
    const out = parseEslintJson(
      JSON.stringify([
        {
          filePath: "/r/src/a.ts",
          messages: [{ ruleId: "no-unused-vars", severity: 2, message: "Unused.", line: 3 }],
        },
        {
          filePath: "/r/src/b.ts",
          messages: [{ ruleId: null, severity: 1, message: "Warn.", line: 1 }],
        },
      ]),
      "/r",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      file: "src/a.ts",
      line: 3,
      rule: "no-unused-vars",
      message: "Unused.",
      error: true,
    });
    expect(out[1]?.rule).toBe("eslint");
    expect(out[1]?.error).toBe(false);
    expect(parseEslintJson("", "/r")).toEqual([]);
    expect(() => parseEslintJson("nope", "/r")).toThrow();
  });

  test("parseBiomeOutput reads header lines and correctness mapping", () => {
    const raw = [
      "src/a.ts:3:7 lint/correctness/noUnusedVariables ━━━━━━━━━━",
      "",
      "  ! Unused variable.",
      "",
      "src/b.ts:1:1 lint/style/useConst ━━━━━━━━━━",
      "",
      "  ! Use const.",
      "",
      "Checked 2 files. Found 2 warnings.",
    ].join("\n");
    const out = parseBiomeOutput(raw, "/r");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      file: "src/a.ts",
      line: 3,
      rule: "lint/correctness/noUnusedVariables",
      message: "Unused variable.",
      error: true,
    });
    expect(out[1]?.error).toBe(false);
  });

  test("parseOxlintJson reads the verified diagnostics shape", () => {
    const out = parseOxlintJson(
      JSON.stringify({
        diagnostics: [
          {
            message: "No debugger",
            code: "eslint(no-debugger)",
            severity: "error",
            filename: "/r/bad.ts",
            labels: [{ span: { line: 2, column: 1 } }],
          },
          {
            message: "Unused",
            code: "eslint(no-unused-vars)",
            severity: "warning",
            filename: "/r/bad.ts",
            labels: [],
          },
        ],
      }),
      "/r",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      file: "bad.ts",
      line: 2,
      rule: "eslint(no-debugger)",
      message: "No debugger",
      error: true,
    });
    expect(out[1]?.line).toBe(0);
    expect(parseOxlintJson("", "/r")).toEqual([]);
    expect(() => parseOxlintJson("nope", "/r")).toThrow();
    expect(() => parseOxlintJson("{}", "/r")).toThrow();
  });

  test("parseTscOutput reads file(line,col) error lines", () => {
    const out = parseTscOutput(
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable.\nFound 1 error.\n",
      "/r",
    );
    expect(out).toEqual([
      { file: "src/a.ts", line: 3, code: "TS2322", message: "Type 'string' is not assignable." },
    ]);
  });

  test("parseTestOutput reads bun, jest, pytest, and go failures", () => {
    const raw = [
      "(fail) suite > breaks [0.5ms]",
      "FAIL src/other.test.ts",
      "FAILED test_x.py::test_y - boom",
      "--- FAIL: TestThing (0.00s)",
      "ok  all good",
    ].join("\n");
    const out = parseTestOutput(raw);
    expect(out.map((f) => f.name)).toEqual([
      "suite > breaks",
      "src/other.test.ts",
      "test_x.py::test_y - boom",
      "TestThing",
    ]);
  });

  test("parseTestOutput falls back to a summary ticket", () => {
    expect(parseTestOutput("3 failed, 10 passed")).toEqual([
      { name: "3 failing (see test output)" },
    ]);
    expect(parseTestOutput("0 fail")).toEqual([]);
    expect(parseTestOutput("all green")).toEqual([]);
  });

  test("parseKnipIssues handles the issues array shape", () => {
    const out = parseKnipIssues({
      issues: [
        { file: "src/a.ts", exports: [], files: [{ name: "src/a.ts" }] },
        { file: "src/b.ts", exports: [{ name: "oldFn", line: 4 }], files: [] },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: "file", file: "src/a.ts", name: "src/a.ts", line: undefined });
    expect(out[1]).toEqual({ kind: "export", file: "src/b.ts", name: "oldFn", line: 4 });
    expect(parseKnipIssues({})).toEqual([]);
  });

  test("parseJscpdReport reads duplications", () => {
    const out = parseJscpdReport({
      duplicates: [
        {
          firstFile: { name: "a.ts", startLoc: { line: 1 } },
          secondFile: { name: "b.ts", startLoc: { line: 10 } },
          lines: 6,
        },
      ],
    });
    expect(out).toEqual([{ a: "a.ts", lineA: 1, b: "b.ts", lineB: 10, lines: 6 }]);
    expect(parseJscpdReport({ duplicates: [] })).toEqual([]);
    expect(() => parseJscpdReport({})).toThrow();
  });
});

describe("fetchToolTickets", () => {
  const allOff = {
    receipt: false,
    plan: false,
    gh: false,
    gitIssue: false,
    jira: false,
    glab: false,
    trackerCli: false,
    giwtLedger: false,
    giwtRuns: false,
    todo: false,
    merges: false,
    lint: false,
    typecheck: false,
    tests: false,
    knip: false,
    jscpd: false,
  };

  test("eslint findings become LT tickets, failures become warnings", async () => {
    const pi = new FakePi();
    // Force the direct-runner path even where a giwt binary exists.
    pi.throwMatching = ["giwt"];
    pi.scripted.push({
      stdout: JSON.stringify([
        {
          filePath: "/r/src/a.ts",
          messages: [{ ruleId: "no-debugger", severity: 2, message: "No.", line: 2 }],
        },
      ]),
    });
    const root = tempDir("fw-tooleslint-");
    writeFileSync(join(root, "eslint.config.js"), "export default [];\n");
    const { tickets, warnings } = await fetchToolTickets(pi, root, { ...allOff, lint: true });
    expect(warnings).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.id).toBe("LT-01");
    expect(tickets[0]?.kind).toBe("bug");
    expect(tickets[0]?.domain).toBe("lint");
    expect(tickets[0]?.title).toContain("src/a.ts:2");

    const pi2 = new FakePi();
    pi2.throwOnExec = true;
    const failed = await fetchToolTickets(pi2, root, { ...allOff, lint: true });
    expect(failed.tickets).toEqual([]);
    expect(failed.warnings.some((w) => w.includes("lint scan failed"))).toBe(true);
  });

  test("tsc errors and test failures map to P1 bugs", async () => {
    const pi = new FakePi();
    pi.throwMatching = ["giwt"];
    pi.scripted.push({ stdout: "src/a.ts(3,7): error TS2322: Bad.\n" });
    pi.scripted.push({ stdout: "(fail) suite > breaks\n" });
    const root = tempDir("fw-toolstsc-");
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    const { tickets } = await fetchToolTickets(pi, root, {
      ...allOff,
      typecheck: true,
      tests: true,
    });
    expect(tickets.map((t) => t.id)).toEqual(["TS-01", "TT-01"]);
    expect(tickets.every((t) => t.priority === "P1")).toBe(true);
  });

  test("knip and biome findings map to cleanup tickets", async () => {
    const pi = new FakePi();
    pi.throwMatching = ["giwt"];
    // fetchToolTickets runs lint before knip — script in call order.
    pi.scripted.push({
      stdout: "src/b.ts:1:1 lint/style/useConst ━━━\n\n  ! Use const.\n",
    });
    pi.scripted.push({
      stdout: JSON.stringify({
        issues: [{ file: "src/old.ts", exports: [], files: [{ name: "src/old.ts" }] }],
      }),
    });
    const root = tempDir("fw-toolsknip-");
    writeFileSync(join(root, "knip.json"), "{}\n");
    writeFileSync(join(root, "biome.json"), "{}\n");
    const { tickets } = await fetchToolTickets(pi, root, { ...allOff, knip: true, lint: true });
    expect(tickets.map((t) => t.id)).toEqual(["LT-01", "KN-01"]);
    expect(tickets[1]?.domain).toBe("knip");
    expect(tickets[0]?.kind).toBe("task");
  });
});

describe("fetchTickets tool wiring", () => {
  test("todo, merges, and tools contribute alongside classic sources", async () => {
    const root = tempDir("fw-wire-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "// TODO: wire it\n");
    writeFileSync(join(root, "eslint.config.js"), "export default [];\n");
    const pi = new FakePi();
    pi.throwMatching = ["giwt"];
    pi.scripted.push({
      stdout: JSON.stringify([
        {
          filePath: join(root, "src", "a.ts"),
          messages: [{ ruleId: "x", severity: 1, message: "W.", line: 1 }],
        },
      ]),
    });
    const { tickets, warnings } = await fetchTickets(pi, root, {
      receipt: false,
      plan: false,
      gh: false,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: false,
      giwtLedger: false,
      giwtRuns: false,
      todo: true,
      merges: false,
      lint: true,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
    });
    expect(warnings).toEqual([]);
    expect(tickets.map((t) => t.id).sort()).toEqual(["LT-01", "TD-01"]);
  });
});

// ---------------------------------------------------------------------------
// Tool runners: oxlint, jscpd, merge failure paths
// ---------------------------------------------------------------------------

describe("fetchToolTickets runners", () => {
  test("oxlint JSON findings map to LT tickets; repo-pinned bin preferred", async () => {
    const pi = new FakePi();
    pi.throwMatching = ["giwt"];
    pi.scripted.push({
      stdout: JSON.stringify({
        diagnostics: [
          {
            message: "No debugger",
            code: "eslint(no-debugger)",
            severity: "error",
            filename: "bad.ts",
            labels: [{ span: { line: 2, column: 1 } }],
          },
        ],
      }),
    });
    const root = tempDir("fw-toolsox-");
    writeFileSync(join(root, ".oxlintrc.json"), "{}\n");
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", "oxlint"), "#!/bin/sh\n");
    const { tickets, warnings } = await fetchToolTickets(pi, root, {
      receipt: false,
      plan: false,
      gh: false,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: false,
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: false,
      lint: true,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
    });
    expect(warnings).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.id).toBe("LT-01");
    expect(tickets[0]?.kind).toBe("bug");
    expect(tickets[0]?.title).toContain("bad.ts:2");
    expect(
      pi.execCalls.some((c) => c.command === join(root, "node_modules", ".bin", "oxlint")),
    ).toBe(true);
  });

  test("jscpd duplications map to CPD tickets", async () => {
    const report = {
      duplicates: [
        {
          firstFile: { name: "a.ts", startLoc: { line: 3 } },
          secondFile: { name: "b.ts", startLoc: { line: 8 } },
          lines: 12,
        },
      ],
    };
    const pi = {
      execCalls: [] as Array<{ command: string; args: string[] }>,
      async exec(command: string, args: string[]): Promise<{ stdout?: string }> {
        this.execCalls.push({ command, args });
        const o = args.indexOf("-o");
        if (o >= 0 && args[o + 1]) {
          writeFileSync(join(args[o + 1], "jscpd-report.json"), JSON.stringify(report));
        }
        return { stdout: "" };
      },
    };
    const root = tempDir("fw-toolsjscpd-");
    writeFileSync(join(root, ".jscpd.json"), "{}\n");
    const { tickets, warnings } = await fetchToolTickets(pi, root, {
      receipt: false,
      plan: false,
      gh: false,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: false,
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: false,
      lint: false,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: true,
    });
    expect(warnings).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.id).toBe("CPD-01");
    expect(tickets[0]?.domain).toBe("duplication");
    expect(tickets[0]?.title).toContain("12 duplicated lines: a.ts:3 ↔ b.ts:8");
    expect(pi.execCalls.some((c) => c.command === "jscpd")).toBe(true);
  });
});

describe("fetchMergeTickets failure paths", () => {
  test("unresolvable base warns instead of throwing", async () => {
    const pi = new FakePi();
    pi.throwOnExec = true;
    const { tickets, warnings } = await fetchTickets(pi, tempDir("fw-mergenobase-"), {
      receipt: false,
      plan: false,
      gh: false,
      gitIssue: false,
      jira: false,
      glab: false,
      trackerCli: false,
      giwtLedger: false,
      giwtRuns: false,
      todo: false,
      merges: true,
      lint: false,
      typecheck: false,
      tests: false,
      knip: false,
      jscpd: false,
    });
    expect(tickets).toEqual([]);
    expect(warnings.some((w) => w.includes("git branch/worktree scan failed"))).toBe(true);
  });

  test("vanished branches and broken worktrees are skipped", async () => {
    const pi = new FakePi();
    pi.throwMatching = ["rev-list", "status"];
    const root = tempDir("fw-mergeskip-");
    pi.scripted.push(
      { stdout: "refs/remotes/origin/dev\n" },
      { stdout: "gone|a1b2c3d|Gone|2026-01-01\n" },
      {
        stdout: [`worktree ${root}`, "HEAD aaa", "branch refs/heads/dev", ""].join("\n"),
      },
    );
    const tickets = await fetchMergeTickets(pi, root);
    expect(tickets).toEqual([]);
    expect(pi.execCalls).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// giwt doctor delegation
// ---------------------------------------------------------------------------

describe("parseDoctorReport", () => {
  test("parses the v1 report shape", () => {
    const checks = parseDoctorReport(
      JSON.stringify({
        version: 1,
        root: "/r",
        checks: [{ id: "lint", tool: "oxlint", ok: true, findings: [] }],
      }),
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe("lint");
  });

  test("throws on garbage, wrong version, and missing checks", () => {
    expect(() => parseDoctorReport("nope")).toThrow();
    expect(() => parseDoctorReport(JSON.stringify({ version: 2, checks: [] }))).toThrow();
    expect(() => parseDoctorReport(JSON.stringify({ version: 1 }))).toThrow();
  });

  test("tolerates run-record chatter before the JSON", () => {
    const checks = parseDoctorReport(
      "Run record: /tmp/x/.tmp/giwt/runs/20260916T000000-1-doctor\n" +
        JSON.stringify({ version: 1, root: "/r", checks: [] }),
    );
    expect(checks).toEqual([]);
  });
});

describe("mapDoctorReport", () => {
  const wanted = new Set<DoctorCheck>(["lint", "typecheck", "tests", "knip", "jscpd"]);

  test("maps each check to prefixed tickets with source priorities", () => {
    const { tickets, warnings } = mapDoctorReport(
      [
        {
          id: "lint",
          tool: "oxlint",
          ok: true,
          findings: [
            { file: "a.ts", line: 1, rule: "r1", message: "Bad.", severity: "error", kind: "bug" },
            {
              file: "b.ts",
              line: 2,
              rule: "r2",
              message: "Meh.",
              severity: "warning",
              kind: "task",
            },
          ],
        },
        {
          id: "typecheck",
          tool: "tsc",
          ok: true,
          findings: [
            {
              file: "c.ts",
              line: 3,
              rule: "TS1",
              message: "Bad type.",
              severity: "error",
              kind: "bug",
            },
          ],
        },
        {
          id: "tests",
          tool: "bun",
          ok: true,
          findings: [{ message: "suite > breaks", severity: "error", kind: "bug" }],
        },
        {
          id: "knip",
          tool: "knip",
          ok: true,
          findings: [
            {
              file: "d.ts",
              rule: "knip:export",
              message: "export: old",
              severity: "warning",
              kind: "task",
            },
          ],
        },
        {
          id: "jscpd",
          tool: "jscpd",
          ok: true,
          findings: [
            { file: "e.ts", message: "2 duplicated lines", severity: "warning", kind: "task" },
          ],
        },
      ],
      "/r",
      wanted,
    );
    expect(warnings).toEqual([]);
    expect(tickets.map((t) => t.id)).toEqual([
      "LT-01",
      "LT-02",
      "TS-03",
      "TT-04",
      "KN-05",
      "CPD-06",
    ]);
    expect(tickets.map((t) => t.priority)).toEqual(["P2", "P3", "P1", "P1", "P3", "P3"]);
    expect(tickets.map((t) => t.source)).toEqual([
      "lint",
      "lint",
      "typecheck",
      "tests",
      "knip",
      "jscpd",
    ]);
    expect(tickets[2]?.title).toContain("TS1");
    expect(tickets[3]?.title).toContain("FAIL");
  });

  test("keeps only wanted checks and surfaces check errors as warnings", () => {
    const { tickets, warnings } = mapDoctorReport(
      [
        { id: "lint", tool: "x", ok: false, error: "boom", findings: [] },
        {
          id: "todo",
          tool: "comment-scan",
          ok: true,
          findings: [{ message: "T.", severity: "warning", kind: "task" }],
        },
      ],
      "/r",
      new Set(["lint"]),
    );
    expect(tickets).toEqual([]);
    expect(warnings).toEqual(["lint: boom"]);
  });
});

describe("fetchViaDoctor", () => {
  function withFakeGiwtBin(): { bin: string; restore: () => void } {
    const bin = tempDir("fw-giwtbin-");
    writeFileSync(join(bin, "giwt"), "#!/bin/sh\n");
    const saved = process.env.PATH ?? "";
    process.env.PATH = `${bin}:${saved}`;
    return {
      bin,
      restore: () => {
        process.env.PATH = saved;
      },
    };
  }

  const allOff = {
    receipt: false,
    plan: false,
    gh: false,
    gitIssue: false,
    jira: false,
    glab: false,
    trackerCli: false,
    giwtLedger: false,
    giwtRuns: false,
    todo: false,
    merges: false,
    lint: false,
    typecheck: false,
    tests: false,
    knip: false,
    jscpd: false,
  };

  test("prefers one doctor call and maps all five tool checks", async () => {
    const { restore } = withFakeGiwtBin();
    try {
      const pi = new FakePi();
      pi.scripted.push({
        stdout: JSON.stringify({
          version: 1,
          root: "/r",
          checks: [
            {
              id: "lint",
              tool: "oxlint",
              ok: true,
              findings: [
                {
                  file: "a.ts",
                  line: 1,
                  rule: "r",
                  message: "Bad.",
                  severity: "error",
                  kind: "bug",
                },
              ],
            },
            { id: "typecheck", tool: "tsc", ok: true, findings: [] },
            {
              id: "tests",
              tool: "bun",
              ok: true,
              findings: [{ message: "s > t", severity: "error", kind: "bug" }],
            },
            { id: "knip", tool: "knip", ok: true, findings: [] },
            {
              id: "jscpd",
              tool: "jscpd",
              ok: true,
              findings: [{ file: "d.ts", message: "dup", severity: "warning", kind: "task" }],
            },
          ],
        }),
      });
      const root = tempDir("fw-doctor-");
      const { tickets, warnings } = await fetchToolTickets(pi, root, {
        ...allOff,
        lint: true,
        typecheck: true,
        tests: true,
        knip: true,
        jscpd: true,
      });
      expect(warnings).toEqual([]);
      expect(tickets.map((t) => t.id)).toEqual(["LT-01", "TT-02", "CPD-03"]);
      expect(pi.execCalls).toHaveLength(1);
      expect(pi.execCalls[0]?.command).toBe("giwt");
      expect(pi.execCalls[0]?.args).toContain("--json");
    } finally {
      restore();
    }
  });

  test("garbage doctor output falls back to direct runners", async () => {
    const { restore } = withFakeGiwtBin();
    try {
      const pi = new FakePi();
      pi.scripted.push({ stdout: "not json" });
      pi.scripted.push({
        stdout: "src/b.ts:1:1 lint/style/useConst ━━━\n\n  ! Use const.\n",
      });
      const root = tempDir("fw-doctorfb-");
      writeFileSync(join(root, "biome.json"), "{}\n");
      const { tickets } = await fetchToolTickets(pi, root, { ...allOff, lint: true });
      expect(tickets.map((t) => t.id)).toEqual(["LT-01"]);
      expect(pi.execCalls[0]?.command).toBe("giwt");
    } finally {
      restore();
    }
  });
});

describe("fetchTickets parallelism + tool-cluster budget", () => {
  const allOff = {
    receipt: false,
    plan: false,
    gh: false,
    gitIssue: false,
    jira: false,
    glab: false,
    trackerCli: false,
    giwtLedger: false,
    giwtRuns: false,
    todo: false,
    merges: false,
    lint: false,
    typecheck: false,
    tests: false,
    knip: false,
    jscpd: false,
  };

  test("independent async sources start concurrently and resolve out of order", async () => {
    const events: string[] = [];
    const deferreds: Array<(v: { stdout?: string }) => void> = [];
    const pi = {
      async exec(command: string): Promise<{ stdout?: string }> {
        events.push(`start:${command}`);
        return new Promise((resolve) => deferreds.push(resolve));
      },
    };
    // Resource contract: no fs fixtures, no real subprocesses — pi stubs exec;
    // tempDir is unique per test.
    const pending = fetchTickets(pi as never, tempDir("fw-par-"), {
      ...allOff,
      gh: true,
      gitIssue: true,
    });
    // Both subprocesses were started before either resolved — the historical
    // sequential impl cannot pass this: it resolves gh before starting git-issue.
    expect(events).toEqual(["start:gh", "start:git-issue"]);
    deferreds[1]?.({ stdout: "" }); // git-issue resolves first, unparseable
    deferreds[0]?.({ stdout: JSON.stringify([{ number: 12, title: "t", labels: [], url: "" }]) });
    const { tickets, warnings } = await pending;
    expect(tickets.map((t) => t.id)).toEqual(["#12"]);
    expect(warnings.some((w) => w.includes("git-issue ls returned no parseable items"))).toBe(true);
  });

  test("git-issue slot execs `git-issue ls` and parses the short format", async () => {
    // Regression pin: the git-issue dispatcher (v1.3.3) has no `list`
    // subcommand — `git-issue list` exits 1 before any store access, so the
    // source silently degraded to a warning on every roster run.
    const pi = new FakePi();
    pi.scripted.push({ stdout: "0674395 [open] TASK-foo: foo\n" });
    const { tickets, warnings } = await fetchTickets(pi, tempDir("fw-gils-"), {
      ...allOff,
      gitIssue: true,
    });
    expect(pi.execCalls[0]?.command).toBe("git-issue");
    expect(pi.execCalls[0]?.args).toEqual(["ls"]);
    expect(tickets.map((t) => t.id)).toEqual(["GI-0674395"]);
    expect(warnings).toEqual([]);
  });

  test("doctor timeout consumes the budget and skips the direct fallback", async () => {
    // Fake giwt on PATH (satisfies giwtOnPath) — never actually executed:
    // pi stubs exec and simulates the killed-doctor wait.
    const bin = tempDir("fw-budgetbin-");
    writeFileSync(join(bin, "giwt"), "#!/bin/sh\nsleep 5\n");
    const saved = process.env.PATH ?? "";
    process.env.PATH = `${bin}:${saved}`;
    try {
      const pi = {
        async exec(): Promise<{ stdout?: string }> {
          await Bun.sleep(200); // outlives the injected 40ms budget
          return { stdout: "" };
        },
      };
      const t0 = Date.now();
      const res = await fetchToolTickets(
        pi as never,
        tempDir("fw-budget-"),
        { ...allOff, lint: true },
        { budgetMs: 40 },
      );
      expect(res.tickets).toEqual([]);
      expect(res.warnings[0]).toContain("cluster budget");
      // Returned after the stub wait, not after any real tool budget.
      expect(Date.now() - t0).toBeLessThan(1999);
    } finally {
      process.env.PATH = saved;
    }
  });
});
