/** Turn-prompt builders for `/bookkeep` subcommands. */

import { discoverPlanningIds } from "./discover";
import type { BookkeepEnv } from "./env";

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function indexCommand(env: BookkeepEnv): string | null {
  return env.planScripts.includes("plan:sync") ? "bun run plan:sync" : null;
}

export function bookkeepUsage(env: BookkeepEnv): string {
  return [
    "bookkeep <audit <epic|ticket>|sync [--fix]|find <query>|issue <request>|list|config>",
    `tracking: .plan ${yesNo(env.planDir)}; index: ${env.planScripts.join(",") || "none"}; worktree-tracker ${yesNo(env.worktreeTracker)}; gh ${yesNo(env.gh)}; jira ${yesNo(env.jira)}; giwt ${yesNo(env.giwtAvailable)}`,
  ].join("\n");
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
