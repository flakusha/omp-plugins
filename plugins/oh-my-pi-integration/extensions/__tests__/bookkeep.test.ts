import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  bookkeepCompletions,
  bookkeepUsage,
  buildAuditPrompt,
  buildFindPrompt,
  buildIssuePrompt,
  buildListPrompt,
  buildScratchAuditPrompt,
  buildSyncPrompt,
  detectBookkeepEnv,
  discoverPlanningIds,
  registerBookkeep,
} from "../commands/bookkeep";
import { resolveBookkeepAction } from "../commands/bookkeep/actions";
import { tryGiwtBookkeep } from "../commands/bookkeep/giwt";
import { formatScratchSummary, orphanTmpCount, scratchSummary } from "../commands/bookkeep/scratch";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

class FakePi {
  commands = new Map<
    string,
    {
      description?: string;
      handler: CommandHandler;
      getArgumentCompletions?: (arg: string) => string[] | null;
    }
  >();
  sentUserMessages: string[] = [];

  registerCommand(
    name: string,
    opts: {
      description?: string;
      handler: CommandHandler;
      getArgumentCompletions?: (arg: string) => string[] | null;
    },
  ): void {
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
function scaffoldPlanItems(root: string): void {
  for (const dir of ["tickets", "epics", "backlog"] as const)
    mkdirSync(join(root, ".plan", dir), { recursive: true });
  writeFileSync(
    join(root, ".plan/tickets/FEAT-add-bookkeep-list.md"),
    "# FEAT: add bookkeep list\n\n**Status:** Not Started\n",
  );
  writeFileSync(
    join(root, ".plan/epics/EPIC-ship-giwt.md"),
    "# EPIC: ship giwt\n\n**Status:** In Progress\n",
  );
  writeFileSync(
    join(root, ".plan/backlog/DRAFT-investigate-foo.md"),
    "# DRAFT: investigate foo\n\n**Status:** Not Started\n",
  );
  writeFileSync(join(root, ".plan/backlog/DONE-old.md"), "# OLD\n\n**Status:** done\n");
}

function scaffoldBins(withJira: boolean): void {
  const bin = join(tempDir("bk-bin-"), "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), "#!/bin/sh");
  if (withJira) writeFileSync(join(bin, "jira"), "#!/bin/sh");
  process.env.PATH = `${bin}:${savedPath}`;
}

/**
 * Unique-per-test scratchpad fixture: 8 files / 272 bytes across 6 glob
 * groups (alpha 160 B, beta 50 B, gamma 30 B, root '*' 12 B, delta 10 B,
 * eps 10 B — the delta/eps tie is broken by name and eps falls off the
 * top-5). `.tmp/root-a.txt` gets a pinned 2020 mtime (oldest). Basenames
 * `solo.md` (.plan) and `deep.txt` (src) are referenced; the other 6 are
 * orphans.
 */
function scaffoldScratchTree(root: string): void {
  mkdirSync(join(root, ".tmp/alpha"), { recursive: true });
  mkdirSync(join(root, ".tmp/beta/inner"), { recursive: true });
  mkdirSync(join(root, ".tmp/gamma"), { recursive: true });
  mkdirSync(join(root, ".tmp/delta"), { recursive: true });
  mkdirSync(join(root, ".tmp/eps"), { recursive: true });
  mkdirSync(join(root, ".plan/tickets"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".tmp/root-a.txt"), "aaaa");
  writeFileSync(join(root, ".tmp/root-b.txt"), "bbbbbbbb");
  writeFileSync(join(root, ".tmp/alpha/big1.dat"), "x".repeat(100));
  writeFileSync(join(root, ".tmp/alpha/big2.dat"), "x".repeat(60));
  writeFileSync(join(root, ".tmp/beta/inner/deep.txt"), "x".repeat(50));
  writeFileSync(join(root, ".tmp/gamma/solo.md"), "x".repeat(30));
  writeFileSync(join(root, ".tmp/delta/delta-note.txt"), "x".repeat(10));
  writeFileSync(join(root, ".tmp/eps/eps-note.txt"), "x".repeat(10));
  writeFileSync(join(root, ".plan/tickets/FEAT-1.md"), "see .tmp/gamma/solo.md for detail\n");
  writeFileSync(join(root, "docs/guide.md"), "# guide\n");
  writeFileSync(join(root, "src/index.ts"), `export const dep = ".tmp/beta/inner/deep.txt";\n`);
  const old = new Date("2020-01-02T03:04:05.000Z");
  utimesSync(join(root, ".tmp/root-a.txt"), old, old);
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

  test("scratch audit prompt probes both directions and cites env facts", () => {
    const root = tempDir("bk-scrp-");
    scaffoldPlanRepo(root);
    const prompt = buildScratchAuditPrompt(detectBookkeepEnv(root));
    expect(prompt).toContain("grep -rlF");
    expect(prompt).toContain("ls -l");
    expect(prompt).toContain(root);
    expect(prompt).toContain(".plan/ yes");
    expect(prompt).toContain("disposition");
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
    expect(usage).toContain("audit <epic|ticket>");
    expect(usage).toContain("audit (bare: .tmp cross-ref)");
    expect(usage).toContain("scratch");
    expect(usage).toContain(".plan no");
  });
});

function setup(_cwd: string): { pi: FakePi; notified: Array<[string, string | undefined]> } {
  const pi = new FakePi();
  registerBookkeep(pi as unknown as ExtensionAPI);
  return { pi, notified: [] as Array<[string, string | undefined]> };
}

describe("bookkeep handler", () => {
  test("bare invoke shows usage without spending a turn", async () => {
    const { pi, notified } = setup(tempDir("bk-hbare-"));
    await pi.commands.get("bookkeep")?.handler("", makeCtx(tempDir("bk-hbare2-"), notified));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("bookkeep <audit");
  });

  test("bare audit starts the scratchpad cross-ref turn", async () => {
    const { pi, notified } = setup(tempDir("bk-haudit0-"));
    await pi.commands.get("bookkeep")?.handler("audit", makeCtx(tempDir("bk-haudit0b-"), notified));
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("grep -rlF");
    expect(notified).toHaveLength(0);
  });

  test("scratch notifies the pure-fs summary without spending a turn", async () => {
    const root = tempDir("bk-hscratch-");
    scaffoldScratchTree(root);
    const { pi, notified } = setup(root);
    await pi.commands.get("bookkeep")?.handler("scratch", makeCtx(root, notified));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("orphan");
    expect(notified[0]?.[0]).toContain("272 bytes");
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

describe("scratchSummary / orphanTmpCount / formatScratchSummary", () => {
  test("sums bytes, counts files, pins the oldest artifact, top-5 globs", () => {
    const root = tempDir("bk-scr-");
    scaffoldScratchTree(root);
    const s = scratchSummary(root);
    expect(s.totalBytes).toBe(272);
    expect(s.fileCount).toBe(8);
    expect(s.oldestPath).toBe(".tmp/root-a.txt");
    expect(s.oldestMtime).toBe(new Date("2020-01-02T03:04:05.000Z").getTime());
    expect(s.topGlobs).toEqual([
      { glob: "alpha/*", bytes: 160 },
      { glob: "beta/*", bytes: 50 },
      { glob: "gamma/*", bytes: 30 },
      { glob: "*", bytes: 12 },
      { glob: "delta/*", bytes: 10 },
    ]);
  });

  test("orphans count unreferenced basenames; referenced ones excluded", () => {
    const root = tempDir("bk-scrorphan-");
    scaffoldScratchTree(root);
    expect(scratchSummary(root).orphanCount).toBe(6);
    expect(orphanTmpCount(root)).toBe(6);
  });

  test("format renders humanized bytes, orphans, oldest, globs", () => {
    const root = tempDir("bk-scrfmt-");
    scaffoldScratchTree(root);
    const text = formatScratchSummary(scratchSummary(root), orphanTmpCount(root));
    expect(text).toContain("272 B");
    expect(text).toContain("orphan");
    expect(text).toContain(".tmp/root-a.txt");
    expect(text).toContain("2020-01-02T03:04:05.000Z");
    expect(text).toContain("alpha/*");
    expect(formatScratchSummary({ ...scratchSummary(root), totalBytes: 2048 }, 0)).toContain(
      "2.0 KiB",
    );
    expect(
      formatScratchSummary({ ...scratchSummary(root), totalBytes: 3 * 1024 * 1024 }, 0),
    ).toContain("3.0 MiB");
  });

  test("no .tmp dir fails open with the empty-summary note", () => {
    const root = tempDir("bk-scrno-");
    expect(scratchSummary(root)).toEqual({
      totalBytes: 0,
      fileCount: 0,
      orphanCount: 0,
      oldestPath: null,
      oldestMtime: null,
      topGlobs: [],
    });
    expect(orphanTmpCount(root)).toBe(0);
    expect(formatScratchSummary(scratchSummary(root), 0)).toContain("(no .tmp dir)");
  });
});

describe("resolveBookkeepAction scratch/bare-audit dispatch", () => {
  test("bare audit returns the bidirectional cross-ref prompt", () => {
    const root = tempDir("bk-rbare-");
    scaffoldScratchTree(root);
    const action = resolveBookkeepAction(detectBookkeepEnv(root), ["audit"]);
    if (!("prompt" in action)) throw new Error("expected prompt action");
    expect(action.prompt).toContain("grep -rlF");
    expect(action.prompt).toContain("ls -l");
    expect(action.prompt).toContain(".plan/");
    expect(action.prompt).toContain("both directions");
  });

  test("audit with a target still builds the reconcile prompt", () => {
    const root = tempDir("bk-rtarget-");
    scaffoldPlanRepo(root);
    const action = resolveBookkeepAction(detectBookkeepEnv(root), ["audit", "EPIC-2"]);
    if (!("prompt" in action)) throw new Error("expected prompt action");
    expect(action.prompt).toContain("EPIC-2");
    expect(action.prompt).toContain("Audit planning artifact");
  });

  test("scratch returns an info message with byte count and orphans", () => {
    const root = tempDir("bk-rscr-");
    scaffoldScratchTree(root);
    const action = resolveBookkeepAction(detectBookkeepEnv(root), ["scratch"]);
    if (!("message" in action)) throw new Error("expected message action");
    expect(action.level).toBe("info");
    expect(action.message).toContain("orphan");
    expect(action.message).toContain("272 bytes");
  });

  test("unknown subcommand still errors", () => {
    const action = resolveBookkeepAction(detectBookkeepEnv(tempDir("bk-runk-")), ["frobnicate"]);
    if (!("message" in action)) throw new Error("expected message action");
    expect(action.level).toBe("error");
    expect(action.message).toContain("unknown subcommand");
  });
});

describe("discoverPlanningIds / buildListPrompt", () => {
  test("returns empty when .plan/ missing", () => {
    expect(discoverPlanningIds(tempDir("bk-disc0-"))).toEqual([]);
  });

  test("returns slug IDs from .plan/{tickets,epics,backlog} and filters done", () => {
    const root = tempDir("bk-disc-");
    scaffoldPlanItems(root);
    const ids = discoverPlanningIds(root).sort();
    expect(ids).toEqual(["DRAFT-investigate-foo", "EPIC-ship-giwt", "FEAT-add-bookkeep-list"]);
    expect(ids).not.toContain("DONE-old");
  });

  test("status line with 'done' inside prose keeps the item", () => {
    // Regression: `**Status:** Not Started (planned, **not** done)` must not
    // trip the terminal-state filter on the trailing word inside parens.
    const root = tempDir("bk-discnotdone-");
    for (const dir of ["tickets", "epics", "backlog"] as const)
      mkdirSync(join(root, ".plan", dir), { recursive: true });
    writeFileSync(
      join(root, ".plan/tickets/FEAT-not-done.md"),
      "# FEAT: not done\n\n**Status:** Not Started (planned, **not** done)\n",
    );
    expect(discoverPlanningIds(root)).toEqual(["FEAT-not-done"]);
  });

  test("emoji and checkbox decorations on terminal status still filter", () => {
    const root = tempDir("bk-discemoji-");
    for (const dir of ["tickets", "epics", "backlog"] as const)
      mkdirSync(join(root, ".plan", dir), { recursive: true });
    writeFileSync(join(root, ".plan/tickets/A-emoji.md"), "# A\n\n**Status:** \u2705 done\n");
    writeFileSync(join(root, ".plan/tickets/B-check.md"), "# B\n\n**Status:** [x] done\n");
    writeFileSync(join(root, ".plan/tickets/C-strike.md"), "# C\n\n**Status:** ~~done~~\n");
    writeFileSync(join(root, ".plan/tickets/D-open.md"), "# D\n\n**Status:** \u2B1C Not Started\n");
    expect(discoverPlanningIds(root)).toEqual(["D-open"]);
  });

  test("fixed / not-a-bug / won't fix lead statuses filter; negated + prose stay", () => {
    const root = tempDir("bk-discfixed-");
    for (const dir of ["tickets", "epics", "backlog"] as const)
      mkdirSync(join(root, ".plan", dir), { recursive: true });
    writeFileSync(join(root, ".plan/tickets/A-fixed.md"), "# A\n\n**Status:** fixed-in-worktree\n");
    writeFileSync(join(root, ".plan/tickets/B-nab.md"), "# B\n\n**Status:** not-a-bug\n");
    writeFileSync(join(root, ".plan/tickets/C-wontfix.md"), "# C\n\n**Status:** won't fix\n");
    writeFileSync(
      join(root, ".plan/tickets/E-oktag.md"),
      "# E\n\n**Status:** [OK] Fixed (f32d0a45)\n",
    );
    writeFileSync(
      join(root, ".plan/tickets/D-open.md"),
      "# D\n\n**Status:** not-yet-implemented\n",
    );
    writeFileSync(
      join(root, ".plan/tickets/F-inprog.md"),
      "# F\n\n**Status:** 🔄 In Progress (fixed by backfill later)\n",
    );
    expect(discoverPlanningIds(root).sort()).toEqual(["D-open", "F-inprog"].sort());
  });

  test("decorative bold line before Status does not shadow the status value", () => {
    // Regression: `**Epic:** … closed-loop …` must not drop an In-Progress
    // ticket just because an earlier bold line's value contains a done-word.
    const root = tempDir("bk-discshadow-");
    for (const dir of ["tickets", "epics", "backlog"] as const)
      mkdirSync(join(root, ".plan", dir), { recursive: true });
    writeFileSync(
      join(root, ".plan/tickets/A-shadow.md"),
      "# A\n\n**Epic:** shipping the closed-loop refactor\n\n**Status:** In Progress\n",
    );
    expect(discoverPlanningIds(root)).toEqual(["A-shadow"]);
  });

  test("list prompt enumerates discovered IDs", () => {
    const root = tempDir("bk-listp-");
    scaffoldPlanRepo(root);
    scaffoldPlanItems(root);
    const prompt = buildListPrompt(detectBookkeepEnv(root));
    expect(prompt).toContain("FEAT-add-bookkeep-list");
    expect(prompt).toContain("EPIC-ship-giwt");
    expect(prompt).toContain("DRAFT-investigate-foo");
    expect(prompt).not.toContain("DONE-old");
    expect(prompt).toContain("read-only");
  });

  test("list prompt without .plan/ explains the tracker fallback", () => {
    const prompt = buildListPrompt(detectBookkeepEnv(tempDir("bk-listno-")));
    expect(prompt).toContain("missing or empty");
    expect(prompt).toContain("tracker backend");
  });
});

describe("bookkeepCompletions", () => {
  test("empty prefix returns all subcommands", () => {
    const root = tempDir("bk-cmp-");
    scaffoldPlanRepo(root);
    const items = bookkeepCompletions(detectBookkeepEnv(root), "");
    expect(items).toContain("audit");
    expect(items).toContain("sync");
    expect(items).toContain("find");
    expect(items).toContain("issue");
    expect(items).toContain("list");
    expect(items).toContain("config");
    expect(items).toContain("scratch");
  });

  test("partial prefix narrows subcommands", () => {
    const env = detectBookkeepEnv(tempDir("bk-cmp1-"));
    expect(bookkeepCompletions(env, "f")).toEqual(["find"]);
  });

  test("audit <prefix> returns plan IDs", () => {
    const root = tempDir("bk-cmp2-");
    scaffoldPlanItems(root);
    expect(bookkeepCompletions(detectBookkeepEnv(root), "audit EPIC")).toContain("EPIC-ship-giwt");
  });

  test("sync <prefix> suggests --fix", () => {
    const env = detectBookkeepEnv(tempDir("bk-cmp3-"));
    expect(bookkeepCompletions(env, "sync -")).toEqual(["--fix"]);
    expect(bookkeepCompletions(env, "sync f")).toEqual([]);
  });

  test("scratch narrows by prefix and completes nothing further", () => {
    const env = detectBookkeepEnv(tempDir("bk-cmp8-"));
    expect(bookkeepCompletions(env, "sc")).toEqual(["scratch"]);
    expect(bookkeepCompletions(env, "scratch ")).toEqual([]);
  });

  test("find <prefix> returns plan IDs and ignores done items", () => {
    const root = tempDir("bk-cmp4-");
    scaffoldPlanItems(root);
    const items = bookkeepCompletions(detectBookkeepEnv(root), "find ");
    expect(items).toContain("FEAT-add-bookkeep-list");
    expect(items).not.toContain("DONE-old");
  });

  test("issue <prefix> returns issue verbs; issue <verb> <id> returns plan IDs", () => {
    const root = tempDir("bk-cmp5-");
    scaffoldPlanItems(root);
    expect(bookkeepCompletions(detectBookkeepEnv(root), "issue ")).toContain("close");
    expect(bookkeepCompletions(detectBookkeepEnv(root), "issue close FEAT")).toContain(
      "FEAT-add-bookkeep-list",
    );
  });

  test("list <prefix> returns nothing further", () => {
    const root = tempDir("bk-cmp6-");
    scaffoldPlanItems(root);
    expect(bookkeepCompletions(detectBookkeepEnv(root), "list ")).toEqual([]);
  });

  test("no .plan/ means no ID completions", () => {
    const env = detectBookkeepEnv(tempDir("bk-cmp7-"));
    expect(bookkeepCompletions(env, "audit ")).toEqual([]);
  });
});

describe("bookkeep list handler", () => {
  test("/bookkeep list starts the discovery turn", async () => {
    const root = tempDir("bk-hlist-");
    scaffoldPlanRepo(root);
    scaffoldPlanItems(root);
    const { pi } = setup(root);
    await pi.commands.get("bookkeep")?.handler("list", makeCtx(root));
    expect(pi.sentUserMessages).toHaveLength(1);
    expect(pi.sentUserMessages[0]).toContain("FEAT-add-bookkeep-list");
    expect(pi.sentUserMessages[0]).toContain("EPIC-ship-giwt");
    expect(pi.sentUserMessages[0]).toContain("DRAFT-investigate-foo");
    expect(pi.sentUserMessages[0]).not.toContain("DONE-old");
  });

  test("/bookkeep wires getArgumentCompletions that delegates to bookkeepCompletions", async () => {
    const { pi } = setup(tempDir("bk-hcmp-"));
    const cmd = pi.commands.get("bookkeep");
    if (!cmd) throw new Error("bookkeep command not registered");
    expect(cmd.getArgumentCompletions).toBeDefined();
    // Completions are TUI items: the suggestion lives on `label`.
    const labels = (cmd.getArgumentCompletions?.("") ?? []).map((item) => item.label);
    // Subcommand listing always works regardless of repo state.
    expect(labels).toEqual(
      expect.arrayContaining(["audit", "sync", "find", "issue", "list", "config"]),
    );
    // Done items are filtered even when the editor uses the real cwd.
    const items = (cmd.getArgumentCompletions?.("audit ") ?? []).map((item) => item.label);
    for (const id of items) expect(id.toLowerCase()).not.toContain("done");
  });
});

describe("bookkeep config handler", () => {
  test("/bookkeep config dumps resolved config without spending a turn", async () => {
    const { pi, notified } = setup(tempDir("bk-hconfig-"));
    const cwd = tempDir("bk-hconfigb-");
    await pi.commands.get("bookkeep")?.handler("config", makeCtx(cwd, notified));
    expect(pi.sentUserMessages).toHaveLength(0);
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("giwt config:");
    expect(notified[0]?.[0]).toContain("receipt path:");
  });

  test("config takes no further completions", () => {
    const env = detectBookkeepEnv(tempDir("bk-cmp8-"));
    expect(bookkeepCompletions(env, "config ")).toEqual([]);
  });
});

// FakePi lacks exec, so giwt-delegation tests use a local exec double.
interface GiwtScripted {
  stdout?: string;
  exitCode?: number;
}

function giwtPi(scripted: GiwtScripted[], opts: { throwOnExec?: boolean } = {}) {
  const notified: Array<[string, string | undefined]> = [];
  const execCalls: Array<{ command: string; args: string[] }> = [];
  const pi = {
    async exec(command: string, args: string[]): Promise<GiwtScripted> {
      execCalls.push({ command, args });
      if (opts.throwOnExec) throw new Error("giwt down");
      return scripted.shift() ?? { stdout: "" };
    },
  } as unknown as ExtensionAPI;
  const ctx = makeCtx(tempDir("bk-giwt-"), notified);
  return { pi, ctx, notified, execCalls };
}

function giwtEnv(root: string) {
  const env = detectBookkeepEnv(root);
  return { ...env, giwtAvailable: true };
}

describe("tryGiwtBookkeep", () => {
  test("unavailable giwt declines to serve", async () => {
    const root = tempDir("bk-giwt0-");
    const { pi, ctx } = giwtPi([]);
    expect(await tryGiwtBookkeep(pi, ctx, detectBookkeepEnv(root), ["audit", "X"])).toBe(false);
  });

  test("unknown subcommand declines to serve", async () => {
    const root = tempDir("bk-giwt1-");
    const { pi, ctx } = giwtPi([]);
    expect(await tryGiwtBookkeep(pi, ctx, giwtEnv(root), ["frobnicate"])).toBe(false);
  });

  test("audit without a target declines to serve", async () => {
    const root = tempDir("bk-giwt2-");
    const { pi, ctx } = giwtPi([]);
    expect(await tryGiwtBookkeep(pi, ctx, giwtEnv(root), ["audit"])).toBe(false);
  });

  test("audit serves giwt plan validate output", async () => {
    const root = tempDir("bk-giwt3-");
    const { pi, ctx, notified, execCalls } = giwtPi([{ stdout: "all clean\n" }]);
    expect(await tryGiwtBookkeep(pi, ctx, giwtEnv(root), ["audit", "EPIC-1"])).toBe(true);
    expect(execCalls[0]).toEqual({ command: "giwt", args: ["plan", "validate"] });
    expect(notified[0]?.[1]).toBe("info");
    expect(notified[0]?.[0]).toContain("all clean");
  });

  test("audit with empty giwt output falls back", async () => {
    const root = tempDir("bk-giwt4-");
    const { pi, ctx } = giwtPi([{ stdout: "" }]);
    expect(await tryGiwtBookkeep(pi, ctx, giwtEnv(root), ["audit", "EPIC-1"])).toBe(false);
  });

  test("audit exec failure falls back", async () => {
    const root = tempDir("bk-giwt5-");
    const { pi, ctx } = giwtPi([], { throwOnExec: true });
    expect(await tryGiwtBookkeep(pi, ctx, giwtEnv(root), ["audit", "EPIC-1"])).toBe(false);
  });

  test("sync serves the plain and --fix forms", async () => {
    const root = tempDir("bk-giwt6-");
    const plain = giwtPi([{ stdout: "in sync\n", exitCode: 0 }]);
    expect(await tryGiwtBookkeep(plain.pi, plain.ctx, giwtEnv(root), ["sync"])).toBe(true);
    expect(plain.execCalls[0]).toEqual({ command: "giwt", args: ["sync"] });
    expect(plain.notified[0]?.[0]).toContain("in sync");
    const fixed = giwtPi([{ stdout: "drift\n", exitCode: 1 }]);
    expect(await tryGiwtBookkeep(fixed.pi, fixed.ctx, giwtEnv(root), ["sync", "--fix"])).toBe(true);
    expect(fixed.execCalls[0]).toEqual({ command: "giwt", args: ["sync", "--fix"] });
    expect(fixed.notified[0]?.[0]).toContain("issues remain");
  });

  test("sync with empty output or exec failure falls back", async () => {
    const root = tempDir("bk-giwt7-");
    const empty = giwtPi([{ stdout: "" }]);
    expect(await tryGiwtBookkeep(empty.pi, empty.ctx, giwtEnv(root), ["sync"])).toBe(false);
    const down = giwtPi([], { throwOnExec: true });
    expect(await tryGiwtBookkeep(down.pi, down.ctx, giwtEnv(root), ["sync"])).toBe(false);
  });
});
