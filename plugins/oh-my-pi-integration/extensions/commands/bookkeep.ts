/**
 * `/bookkeep` — planning-hygiene dispatcher.
 *
 * Subcommands: `audit <epic|ticket>` (reconcile tracker claims against code),
 * `sync [--fix]` (verify the planning index), `find <query>` (locate items),
 * `issue <request>` (tracker operations via the detected backend),
 * `list` (enumerate discovered planning items).
 *
 * The handler detects the tracking environment with fs checks only (no turn
 * spent) and bakes the facts into the turn prompt: in-repo `.plan/` + index
 * script first, then the repo worktree tracker CLI, then `gh`, then `jira`.
 * Bare `/bookkeep` answers read-only via `notify` (env summary + usage).
 *
 * Tab completions surface subcommand names, audit/sync/issue verb hints, and
 * planning-item IDs discovered from `.plan/{tickets,epics,backlog}` so the
 * user does not need to memorise slugs.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { argumentItems } from "./completions";

export interface BookkeepEnv {
  /** Session cwd (repo root guess). */
  root: string;
  /** `.plan/` planning dir present. */
  planDir: boolean;
  /** `plan:*` index scripts present in package.json. */
  planScripts: string[];
  /** `scripts/worktree/{ticket,issues,prs,gi}` tracker CLI present. */
  worktreeTracker: boolean;
  /** `gh` on PATH. */
  gh: boolean;
  /** `jira` on PATH. */
  jira: boolean;
}

const PLAN_SCRIPTS = ["plan:sync", "plan:find", "plan:map", "plan:docs"];
const TRACKER_COMMANDS = ["ticket", "issues", "prs", "gi"];
const BOOKKEEP_SUBCOMMANDS = ["audit", "sync", "find", "issue", "list"] as const;
/** Verbs the `issue` subcommand commonly takes; pure suffix hints. */
const ISSUE_VERBS = ["list", "view", "search", "create", "close", "comment", "assign"];

export function onPath(bin: string, pathEnv?: string): boolean {
  const path = pathEnv ?? process.env.PATH ?? "";
  return path.split(":").some((dir) => {
    try {
      return existsSync(join(dir, bin));
    } catch {
      return false;
    }
  });
}

function planScriptsOf(root: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return PLAN_SCRIPTS.filter((s) => typeof pkg.scripts?.[s] === "string");
  } catch {
    return [];
  }
}

/** Pure detection of the issue-tracking environment for a session cwd. */
export function detectBookkeepEnv(cwd: string | undefined): BookkeepEnv {
  const root = cwd ?? process.cwd();
  const worktreeTracker = TRACKER_COMMANDS.some(
    (cmd) =>
      existsSync(join(root, `scripts/worktree/${cmd}.ts`)) ||
      existsSync(join(root, `scripts/worktree/${cmd}.mjs`)),
  );
  return {
    root,
    planDir: existsSync(join(root, ".plan")),
    planScripts: planScriptsOf(root),
    worktreeTracker,
    gh: onPath("gh"),
    jira: onPath("jira"),
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function indexCommand(env: BookkeepEnv): string | null {
  return env.planScripts.includes("plan:sync") ? "bun run plan:sync" : null;
}

export function bookkeepUsage(env: BookkeepEnv): string {
  return [
    "bookkeep <audit <epic|ticket>|sync [--fix]|find <query>|issue <request>|list>",
    `tracking: .plan ${yesNo(env.planDir)}; index: ${env.planScripts.join(",") || "none"}; worktree-tracker ${yesNo(env.worktreeTracker)}; gh ${yesNo(env.gh)}; jira ${yesNo(env.jira)}`,
  ].join("\n");
}
/**
 * Status line filter: `**Status:** done`, `** Status: ** = …`, etc.
 * Anchored at the start of the captured value (after emoji / checkbox /
 * strikethrough decoration) so prose like `**Status:** Not Started
 * (planned, **not** done)` does not falsely trip on the trailing word.
 */
const DONE_STATUS_RE = /\*\*\s*([^*]+?)\s*\*\*\s*[:=]?\s*(.+)/gi;
const DONE_LEAD_RE =
  /^\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*|\[[^\]]*\]\s*|~~?\s*)?(done|fixed|complete[ds]?|closed|shipped|applied|finished|resolved|won'?t\s+(?:fix|do)|not-a-bug|deferred|cancelled|abandoned)\b/iu;

/**
 * Pure: IDs the user could target for audit/find/issue. Done items filtered.
 *
 * Walks `.plan/{tickets,epics,backlog}` for `*.md` files, drops any whose
 * bold-status line matches DONE_LEAD_RE. Implemented here (rather than via
 * `planTickets`) because `find-work` matches any status line anywhere in the
 * first 4 KiB, while `/bookkeep` only honors the bold line actually labeled
 * `status`. Both anchor the terminal-state word at the START of the decorated
 * value (emoji/bracket tag/strikethrough) so prose like "planned, **not**
 * done" or "In Progress (… fixed …)" keeps the item listed.
 */
export function discoverPlanningIds(root: string): string[] {
  if (!existsSync(join(root, ".plan"))) return [];
  const out: string[] = [];
  for (const dir of ["tickets", "epics", "backlog"] as const) {
    const full = join(root, ".plan", dir);
    if (!existsSync(full)) continue;
    let entries: string[];
    try {
      entries = readdirSync(full).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of entries) {
      const id = file.replace(/\.md$/, "");
      let body: string;
      try {
        body = readFileSync(join(full, file), "utf8");
      } catch {
        continue;
      }
      if (DONE_LEAD_RE.test(doneStatusValue(body))) continue;
      out.push(id);
    }
  }
  return out;
}

/**
 * Status value for a ticket body: the bold line actually labeled `status`
 * (any case) wins, so a decorative bold line elsewhere cannot shadow the real
 * status value; otherwise the first bold line's value is used.
 */
function doneStatusValue(body: string): string {
  let first = "";
  for (const m of body.matchAll(DONE_STATUS_RE)) {
    const value = (m[2] ?? "").trim();
    if (!first) first = value;
    if (/^status$/i.test((m[1] ?? "").trim().replace(/:$/, ""))) return value;
  }
  return first;
}
/** Turn prompt: enumerate planning items available to audit/find/issue. */
export function buildListPrompt(env: BookkeepEnv): string {
  const ids = discoverPlanningIds(env.root);
  const table = ids.length
    ? ids.map((id, i) => `  ${i + 1}. ${id}`).join("\n")
    : "  (none — `.plan/` missing or empty)";
  const fallbackLine = env.planDir
    ? "Source: `.plan/{tickets,epics,backlog}` scan; items whose status value starts with a terminal state (done, closed, shipped, …) are filtered out."
    : `Source fallback: \`.plan/\` missing in ${env.root}` +
      (env.worktreeTracker ? " → worktree tracker CLI," : "") +
      (env.gh ? " → gh issue list," : "") +
      (env.jira ? " → jira search," : "") +
      " run read-only and report which served the request.";
  return [
    `Enumerate planning items discoverable in ${env.root} (read-only, no edits):`,
    table,
    fallbackLine,
    "These IDs are the candidates `audit` accepts. If `.plan/` is absent, fall through to the first available tracker backend (worktree tracker CLI / gh / jira) and report items with the same ID + status shape.",
  ].join("\n");
}

/** Turn prompt: reconcile one epic/ticket's claims against the code. */
export function buildAuditPrompt(env: BookkeepEnv, target: string): string {
  const verifyStep = indexCommand(env)
    ? `Verify: ${indexCommand(env)} must report zero mismatches; git diff --stat -- .plan/ sanity — every edited file must appear.`
    : `No planning-index command detected in ${env.root}: verify against the detected tracker backend instead (same zero-drift requirement).`;
  const sourceStep = env.planDir
    ? `Read the epic/ticket file(s) for '${target}' in full (.plan/epics, .plan/tickets, .plan/backlog) — Status line, every bullet, every cross-reference.`
    : `No .plan/ dir in ${env.root}: resolve '${target}' through the detected tracker backend (worktree tracker CLI, gh, or jira) and treat its body as the claim set.`;
  return [
    `Audit planning artifact '${target}' against the code in ${env.root} — all in the same turn, no deferrals.`,
    `1. ${sourceStep}`,
    "2. Verify each status claim against the code (targeted reads; symbol grep; migrations vs schema). Three buckets: code-done → append a Verification Notes block with file:line + test names; code-partial → mark the gap in place with (OPEN GAP); false-claim → set status to PARTIALLY APPLIED with a Reconciliation block citing the contradicting file:line evidence, and do NOT close the linked issue.",
    "3. Cross-reference sweep in the same turn: grep the planning area for every renamed/moved symbol or file and update downstream trackers that reference it.",
    `4. ${verifyStep}`,
    "Summarize in 3 buckets: closable (issue IDs), false-claim (ticket IDs + actual code state), not-started (tickets needing new work).",
  ].join("\n");
}

/** Turn prompt: run the planning-index reconciliation. */
export function buildSyncPrompt(env: BookkeepEnv, fix: boolean): string {
  const cmd = indexCommand(env);
  if (!cmd) {
    return [
      `No planning-index command (plan:sync) detected in ${env.root} (planDir: ${yesNo(env.planDir)}).`,
      "Locate the repo's index-reconciliation step instead: check package.json scripts for a sync/index command and the worktree tracker CLI; run the closest match read-only, report mismatches/orphans/phantoms, and fix nothing without explicit user confirm.",
    ].join("\n");
  }
  return [
    `Run the planning-index reconciliation for ${env.root}: ${cmd}${fix ? " --fix" : ""}.`,
    `Report mismatches, orphan files, and phantom entries.${fix ? "" : " Read-only: do not pass --fix and do not hand-edit index files — the index command owns the format."}`,
    "If the command reports drift the read-only run cannot explain, stop and report; do not invent index entries by hand.",
  ].join("\n");
}

/** Turn prompt: find planning items matching a query. */
export function buildFindPrompt(env: BookkeepEnv, query: string): string {
  const tool = env.planScripts.includes("plan:find")
    ? "bun run plan:find"
    : env.planDir
      ? "grep over .plan/tickets, .plan/epics, .plan/backlog"
      : "the detected tracker backend (gh issue list --search / jira search)";
  return [
    `Find planning items matching '${query}' in ${env.root} using ${tool}.`,
    "Report IDs with one-line status each. Read-only: no edits.",
  ].join("\n");
}

/** Turn prompt: serve a tracker request via the first available backend. */
export function buildIssuePrompt(env: BookkeepEnv, request: string): string {
  return [
    `Serve the tracker request '${request}' in ${env.root}, using the first available backend — verify auth before any write:`,
    `1. In-repo planning docs (.plan/tickets|epics|backlog): ${yesNo(env.planDir)}; index command: ${indexCommand(env) ?? "none"}.`,
    `2. Repo worktree tracker CLI (scripts/worktree/{ticket,issues,prs,gi}): ${yesNo(env.worktreeTracker)}.`,
    `3. GitHub CLI (gh): installed ${yesNo(env.gh)} — gh auth status first; reads (view/list/search) need no confirm, writes (create/close/comment) need user confirm.`,
    `4. Jira CLI: installed ${yesNo(env.jira)} — verify project/config before writes; writes need user confirm.`,
    "Report which backend served the request with the resulting IDs/links.",
  ].join("\n");
}

type BookkeepAction = { prompt: string } | { message: string; level: "info" | "error" };

function auditAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  if (!rest[0]) return { message: "usage: /bookkeep audit <epic|ticket>", level: "error" };
  return { prompt: buildAuditPrompt(env, rest[0]) };
}

function syncAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  return { prompt: buildSyncPrompt(env, rest.includes("--fix")) };
}

function findAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  if (rest.length === 0) return { message: "usage: /bookkeep find <query>", level: "error" };
  return { prompt: buildFindPrompt(env, rest.join(" ")) };
}

function issueAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  if (rest.length === 0) return { message: "usage: /bookkeep issue <request>", level: "error" };
  return { prompt: buildIssuePrompt(env, rest.join(" ")) };
}

const BOOKKEEP_ACTIONS: Record<string, (env: BookkeepEnv, rest: string[]) => BookkeepAction> = {
  audit: auditAction,
  sync: syncAction,
  find: findAction,
  issue: issueAction,
  list: (env: BookkeepEnv) => ({ prompt: buildListPrompt(env) }),
};

function resolveBookkeepAction(env: BookkeepEnv, argv: string[]): BookkeepAction {
  const sub = argv[0];
  if (sub === undefined) return { message: bookkeepUsage(env), level: "info" };
  const run = BOOKKEEP_ACTIONS[sub];
  if (!run)
    return { message: `unknown subcommand '${sub}'. ${bookkeepUsage(env)}`, level: "error" };
  return run(env, argv.slice(1));
}

/**
 * Tab completion for `/bookkeep …`. First word → subcommands; subcommand
 * args → verb hints plus discovered planning-item IDs from `.plan/`.
 *
 * Pure: takes the env so callers can pre-detect once per render. Filtering
 * is case-insensitive substring to match how editors narrow a prefix list.
 */
export function bookkeepCompletions(env: BookkeepEnv, argPrefix: string): string[] {
  // Editor sends `find ` (trailing whitespace) when the cursor sits after the
  // subcommand — keep that empty slot so completions target the new arg.
  const endsWithSpace = /\s$/.test(argPrefix);
  const tokens = argPrefix.trim().split(/\s+/).filter(Boolean);
  const sub = tokens[0]?.toLowerCase();
  const lastPrefix = (endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "")).toLowerCase();
  if (!sub) return BOOKKEEP_SUBCOMMANDS.filter((s) => s.startsWith(lastPrefix));
  const idCompletions = discoverPlanningIds(env.root).filter((id) =>
    id.toLowerCase().includes(lastPrefix),
  );
  switch (sub) {
    case "audit":
      return idCompletions;
    case "sync":
      return ["--fix"].filter((f) => f.startsWith(lastPrefix));
    case "find":
      return idCompletions;
    case "issue": {
      // Stage 1: sub alone, or sub + partial second token → verbs.
      // Stage 2: complete verb + space, or 3+ tokens → IDs.
      const inVerbStage = tokens.length === 1 || (tokens.length === 2 && !endsWithSpace);
      return inVerbStage ? ISSUE_VERBS.filter((v) => v.startsWith(lastPrefix)) : idCompletions;
    }
    case "list":
      return [];
    default:
      return BOOKKEEP_SUBCOMMANDS.filter((s) => s.startsWith(lastPrefix));
  }
}

/** Register `/bookkeep` on the plugin factory's `pi`. */
export function registerBookkeep(pi: ExtensionAPI): void {
  pi.registerCommand("bookkeep", {
    description: "Planning hygiene: `/bookkeep <audit|sync|find|issue|list> ...`",
    // NOTE: process.cwd() because getArgumentCompletions gets no ctx — assumes TUI cwd == process cwd (see completions.ts).
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(
        argumentPrefix,
        bookkeepCompletions(detectBookkeepEnv(process.cwd()), argumentPrefix),
      ),
    handler: async (args, ctx) => {
      const action = resolveBookkeepAction(
        detectBookkeepEnv(ctx.cwd),
        args.trim().split(/\s+/).filter(Boolean),
      );
      if ("prompt" in action) {
        await pi.sendUserMessage(action.prompt);
        return;
      }
      ctx.ui.notify(action.message, action.level);
    },
  });
}
