import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  buildSyncPrompt,
  detectBookkeepEnv,
  discoverPlanningIds,
  registerBookkeep,
} from "../commands/bookkeep";

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
    expect(labels).toEqual(expect.arrayContaining(["audit", "sync", "find", "issue", "list"]));
    // Done items are filtered even when the editor uses the real cwd.
    const items = (cmd.getArgumentCompletions?.("audit ") ?? []).map((item) => item.label);
    for (const id of items) expect(id.toLowerCase()).not.toContain("done");
  });
});
