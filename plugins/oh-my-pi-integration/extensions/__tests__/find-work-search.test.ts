/**
 * Tests for the `/find-work` search extension (`-s`), directive flags
 * (`-m`/`-d`), fast mode, and the patch-review roster source.
 *
 * Resource contract (parallel-safe): every test owns an mkdtemp fixture dir
 * removed in `finally`; the fake exec surface is per-test; no fixed paths,
 * no ordering dependence.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkSources, WorkTicket } from "../commands/find-work";
import {
  buildPatchTicket,
  buildSelectedPrompt,
  fetchPatchReviewTickets,
  fetchTickets,
  labelTickets,
  parseFindWorkArgs,
  parsePatchCounts,
  parseShortstat,
  planTickets,
  registerFindWork,
  renderList,
  searchTickets,
} from "../commands/find-work";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function ticket(overrides: Partial<WorkTicket> = {}): WorkTicket {
  return {
    id: "T-1",
    title: "fix the parser",
    source: ".plan",
    kind: "task",
    priority: "P2",
    domain: "tickets",
    ...overrides,
  };
}

const TOOL_HEAVY_SOURCES: WorkSources = {
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
  patches: false,
  lint: true,
  typecheck: true,
  tests: true,
  knip: true,
  jscpd: true,
};

// ---------------------------------------------------------------------------
// Argument parsing: -s / -m / -d / --fast
// ---------------------------------------------------------------------------

describe("parseFindWorkArgs flags", () => {
  test("-s consumes words until the next flag; -m directive likewise", () => {
    const { args, error } = parseFindWorkArgs(["-s", "perf", "audit", "-m", "fix", "parser"]);
    expect(error).toBeUndefined();
    expect(args.search).toBe("perf audit");
    expect(args.directive).toBe("fix parser");
    expect(args.query).toBe("");
  });

  test("-d is an alias of -m; long forms work; --fast is boolean", () => {
    const { args } = parseFindWorkArgs(["--search", "auth", "-d", "ship it", "--fast"]);
    expect(args.search).toBe("auth");
    expect(args.directive).toBe("ship it");
    expect(args.fast).toBe(true);
  });

  test("flags work after free text starts", () => {
    const { args } = parseFindWorkArgs(["ask", "fix", "-s", "perf", "the parser"]);
    expect(args.mode).toBe("ask");
    expect(args.query).toBe("fix");
    expect(args.search).toBe("perf the parser");
  });

  test("keywords inside a flag value are never applied", () => {
    const { args } = parseFindWorkArgs(["-s", "bugs"]);
    expect(args.search).toBe("bugs");
    expect(args.kinds).toEqual([]);
  });

  test("value flags require a value", () => {
    expect(parseFindWorkArgs(["-s"]).error).toContain("'-s' requires a value");
    expect(parseFindWorkArgs(["fix", "-m"]).error).toContain("'-m' requires a value");
  });

  test("no flags keeps the legacy grammar intact", () => {
    const { args, error } = parseFindWorkArgs(["ask", "bugs", "propose a batch"]);
    expect(error).toBeUndefined();
    expect(args.mode).toBe("ask");
    expect(args.kinds).toEqual(["bug"]);
    expect(args.query).toBe("propose a batch");
  });
});

// ---------------------------------------------------------------------------
// Tiered search
// ---------------------------------------------------------------------------

describe("searchTickets tiering", () => {
  const roster: WorkTicket[] = [
    ticket({
      id: "TASK-perf",
      title: "speed up the indexer",
      tags: ["perf", "api"],
      epic: "EPIC-4",
    }),
    ticket({ id: "TASK-perf-sib", title: "cache index results", tags: ["api"], epic: "EPIC-4" }),
    ticket({ id: "TASK-indexer", title: "indexer backpressure", tags: [] }),
    ticket({ id: "EPIC-4", title: "Epic: indexing throughput", kind: "epic", tags: [] }),
    ticket({ id: "TASK-unrelated", title: "docs pass", tags: [] }),
  ];

  test("direct tag hit ranks tier 1, fuzzy tier 2, connections tier 3", () => {
    const hits = searchTickets(roster, "/unused", "perf");
    expect(hits.map((h) => [h.tier, h.ticket.id])).toEqual([
      [1, "TASK-perf"],
      [2, "TASK-perf-sib"],
      [3, "EPIC-4"],
    ]);
    expect(hits[0]?.via).toBe("tag:perf");
    expect(hits[1]?.via).toBe("fuzzy");
    expect(hits[2]?.via).toBe("epic-item:EPIC-4");
    // No query token lands in "TASK-unrelated"/docs → excluded entirely.
    expect(hits.some((h) => h.ticket.id === "TASK-unrelated")).toBe(false);
  });

  test("fuzzy candidates need every token to land somewhere", () => {
    const hits = searchTickets(roster, "/unused", "index backpressure");
    const top = hits.find((h) => h.ticket.id === "TASK-indexer");
    expect(top?.tier).toBe(2);
    expect(top?.via).toBe("fuzzy");
    // No query token lands in "TASK-unrelated"/docs → excluded entirely.
    expect(hits.some((h) => h.ticket.id === "TASK-unrelated")).toBe(false);
  });

  test("tier-1 seed is not duplicated as a fuzzy candidate", () => {
    const hits = searchTickets(roster, "/unused", "perf");
    expect(hits.filter((h) => h.ticket.id === "TASK-perf")).toHaveLength(1);
  });

  test("connection modes: shared epic, epic item, shared tag", () => {
    const seed = ticket({ id: "S", title: "seed", tags: ["crypto"], epic: "epic-auth.md" });
    const roster2 = [
      seed,
      ticket({ id: "SIB", title: "sibling", epic: "EPIC-auth" }),
      ticket({ id: "EPIC-auth", title: "auth flow", kind: "epic" }),
      ticket({ id: "TAGGED", title: "other", tags: ["crypto"] }),
    ];
    const hits = searchTickets(roster2, "/unused", "crypto");
    const byId = new Map(hits.map((h) => [h.ticket.id, h]));
    expect(byId.get("SIB")?.via).toBe("epic:epic-auth.md");
    expect(byId.get("EPIC-auth")?.via).toBe("epic-item:EPIC-auth");
    expect(byId.get("TAGGED")?.via).toBe("tag:crypto");
  });

  test("bare TASK refs inside the seed's epic file connect siblings", () => {
    const dir = tempDir("fw-search-ref-");
    try {
      const ticketsDir = join(dir, ".plan", "tickets");
      const epicsDir = join(dir, ".plan", "epics");
      mkdirSync(ticketsDir, { recursive: true });
      mkdirSync(epicsDir, { recursive: true });
      writeFileSync(
        join(ticketsDir, "TASK-seed.md"),
        "# TASK-seed: seed\n\n**Tags:** perf\n**Epic:** epic-x\n",
      );
      // Unbound ticket reachable only through the epic file's bare TASK ref.
      writeFileSync(join(ticketsDir, "TASK-sib.md"), "# TASK-sib: sibling\n\n**Status:** open\n");
      writeFileSync(
        join(epicsDir, "epic-x.md"),
        "# Epic X\n\n- TASK-seed: seed\n- TASK-sib: sibling\n",
      );
      const tickets = planTickets(dir);
      const hits = searchTickets(tickets, dir, "perf");
      const sib = hits.find((h) => h.ticket.id === "TASK-sib");
      expect(sib?.tier).toBe(3);
      expect(sib?.via).toBe("ref:epic-x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty/blank query and cap are honored", () => {
    expect(searchTickets(roster, "/unused", "  ")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) =>
      ticket({ id: `T-${i}`, title: `perf thing ${i}` }),
    );
    expect(searchTickets(many, "/unused", "perf", { max: 3 })).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Roster extraction: tags + epic binding
// ---------------------------------------------------------------------------

describe("planTickets tag/epic extraction", () => {
  test("labels become tags; Epic header becomes the binding; body prose never does", () => {
    const dir = tempDir("fw-plan-meta-");
    try {
      const ticketsDir = join(dir, ".plan", "tickets");
      mkdirSync(ticketsDir, { recursive: true });
      const filler = Array.from({ length: 34 }, (_, i) => `filler line ${i}`);
      writeFileSync(
        join(ticketsDir, "TASK-meta.md"),
        "# TASK-meta: has meta\n\n**Status:** open\n**Labels:** perf, p1\n**Epic:** EPIC-9\n\n" +
          `${filler.join("\n")}\n\n**Epic:** body-prose-epic\n`,
      );
      const tickets = planTickets(dir);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]?.tags).toEqual(["perf", "p1"]);
      expect(tickets[0]?.epic).toBe("EPIC-9");
      expect(tickets[0]?.priority).toBe("P1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Patch-review source
// ---------------------------------------------------------------------------

describe("patch review", () => {
  test("parsePatchCounts reads branch, changes, and untracked", () => {
    const counts = parsePatchCounts(
      ["## feat/search...origin/feat/search", " M src/a.ts", "?? new.ts", "", "?? b.ts"].join("\n"),
    );
    expect(counts).toEqual({ branch: "feat/search", changed: 3, untracked: 2 });
    expect(parsePatchCounts("## master\n").changed).toBe(0);
  });

  test("parseShortstat reads component counts", () => {
    expect(parseShortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)")).toEqual({
      files: 3,
      insertions: 10,
      deletions: 2,
    });
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
      files: 1,
      insertions: 1,
      deletions: 0,
    });
  });

  test("buildPatchTicket: clean tree null; dirty perf/bughunt review item", () => {
    expect(
      buildPatchTicket(
        { branch: "main", changed: 0, untracked: 0 },
        { files: 0, insertions: 0, deletions: 0 },
      ),
    ).toBeNull();
    const t = buildPatchTicket(
      { branch: "feat/x", changed: 5, untracked: 2 },
      { files: 5, insertions: 40, deletions: 3 },
    );
    expect(t).toMatchObject({
      id: "PATCH",
      source: "patch",
      kind: "task",
      priority: "P2",
      domain: "review",
    });
    expect(t?.title).toContain("5 files changed");
    expect(t?.title).toContain("+40/-3");
    expect(t?.title).toContain("2 untracked");
  });

  test("fetchPatchReviewTickets execs two read-only git calls", async () => {
    const scripted = ["## main\n M a.ts\n", " 1 file changed, 2 insertions(+)"];
    const execCalls: string[] = [];
    const pi = {
      async exec(command: string): Promise<{ stdout?: string }> {
        execCalls.push(command);
        return { stdout: scripted.shift() ?? "" };
      },
    };
    const tickets = await fetchPatchReviewTickets(pi, "/anywhere");
    expect(execCalls).toEqual(["git", "git"]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.id).toBe("PATCH");
  });
});

// ---------------------------------------------------------------------------
// Fast mode
// ---------------------------------------------------------------------------

describe("fetchTickets fast mode", () => {
  test("fast: tool cluster never execs; slow: it does", async () => {
    const dir = tempDir("fw-fast-");
    try {
      const execCalls: Array<{ command: string }> = [];
      const pi = {
        async exec(command: string): Promise<{ stdout?: string }> {
          execCalls.push({ command });
          return { stdout: "" };
        },
      };
      const fast = await fetchTickets(pi, dir, TOOL_HEAVY_SOURCES, { fast: true });
      expect(execCalls).toHaveLength(0);
      expect(fast.warnings).toEqual([]);
      const slow = await fetchTickets(pi, dir, TOOL_HEAVY_SOURCES);
      expect(execCalls.length).toBeGreaterThan(0);
      expect(slow.warnings.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Rendering + prompts
// ---------------------------------------------------------------------------

describe("search annotation in roster render", () => {
  test("itemLine carries the match provenance; plain items keep their shape", () => {
    const list = renderList(
      labelTickets(
        [ticket({ matchedVia: "tag:perf" }), ticket({ id: "T-2", title: "plain" })],
        "order",
      ),
      false,
    );
    expect(list).toContain("match: tag:perf");
    expect(list).toContain("T-2");
  });

  test("selected prompt includes directive and search context", () => {
    const out = buildSelectedPrompt([ticket()], "tests first, then perf", "perf audit");
    expect(out).toContain("User directive: tests first, then perf");
    expect(out).toContain("Search query (-s): perf audit");
  });
});

// ---------------------------------------------------------------------------
// Handler end-to-end (list -s perf in a fixture repo)
// ---------------------------------------------------------------------------

describe("/find-work handler with -s", () => {
  test("list -s perf renders the roster without invoking any tooling", async () => {
    const dir = tempDir("fw-handler-s-");
    try {
      const ticketsDir = join(dir, ".plan", "tickets");
      mkdirSync(ticketsDir, { recursive: true });
      writeFileSync(
        join(ticketsDir, "TASK-direct.md"),
        "# TASK-direct: direct perf hit\n\n**Tags:** perf\n",
      );
      writeFileSync(
        join(ticketsDir, "TASK-sibling.md"),
        "# TASK-sibling: sibling item\n\n**Tags:** perf\n",
      );
      const notified: string[] = [];
      const execCalls: string[] = [];
      const realPath = process.env.PATH;
      process.env.PATH = ""; // no gh/git-issue/git on PATH — deterministic sources
      try {
        const fakePi = {
          commands: new Map<
            string,
            { description?: string; handler: (args: string, ctx: unknown) => Promise<void> }
          >(),
          registerCommand(
            name: string,
            opts: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> },
          ): void {
            this.commands.set(name, opts);
          },
          async exec(command: string): Promise<{ stdout?: string }> {
            execCalls.push(command);
            return { stdout: "" };
          },
          async sendUserMessage(): Promise<void> {},
        };
        registerFindWork(fakePi as never);
        const ctx = {
          cwd: dir,
          ui: { notify: (message: string) => notified.push(message) },
        };
        await fakePi.commands.get("find-work")?.handler("list -s perf", ctx);
        const roster = notified.find((m) => m.includes("open work item"));
        expect(roster).toBeDefined();
        expect(roster).toContain("TASK-direct");
        expect(roster).toContain("TASK-sibling");
        // Fast mode implied by -s: no lint/typecheck/test/knip/jscpd subprocess.
        expect(execCalls).toHaveLength(0);
      } finally {
        process.env.PATH = realPath;
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // unreachable — the inner try/finally owns cleanup
      throw new Error("unreachable");
    }
  });
});
