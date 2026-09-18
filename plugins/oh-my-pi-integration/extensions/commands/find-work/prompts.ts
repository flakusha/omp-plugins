/**
 * `/find-work` filtering + prompts: kind/query filtering of the fetched
 * roster and the turn prompts for selected, chat, orchestrate, and agent-
 * fallback paths.
 */

import { groupBatches, renderList } from "./render";
import { describeSources } from "./sources";
import type { FindWorkArgs, LabeledTicket, WorkSources, WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// Filtering + prompts
// ---------------------------------------------------------------------------

/** Kind filter, then whole-query substring filter over id+title. */
export function filterTickets(tickets: WorkTicket[], args: FindWorkArgs): WorkTicket[] {
  return tickets.filter((t) => {
    if (args.kinds.length > 0 && !args.kinds.includes(t.kind)) return false;
    if (args.query) {
      const hay = `${t.id} ${t.title}`.toLowerCase();
      if (!hay.includes(args.query.toLowerCase())) return false;
    }
    return true;
  });
}

function ticketBullets(tickets: WorkTicket[]): string {
  return tickets.map((t) => `- [${t.priority} ${t.id}] ${t.title} (${t.source})`).join("\n");
}

/** Turn prompt for a dialog-selected batch (+ optional user directive). */
export function buildSelectedPrompt(selected: WorkTicket[], directive: string): string {
  return [
    "Work batch selected via /find-work:",
    ticketBullets(selected),
    directive
      ? `User directive: ${directive}`
      : "Work through the tickets above in priority order (P0 first): implement each, verify with the repo's gate, and report a per-ticket verdict.",
    "Stop for user confirm on anything destructive or ambiguous.",
  ].join("\n");
}

/** Turn prompt when the user chose "Chat about this" in the dialog. */
export function buildChatPrompt(labeled: LabeledTicket[], directive: string): string {
  return [
    "Open work items from /find-work:",
    renderList(labeled, false),
    directive
      ? `The user wants to discuss: ${directive}`
      : "The user wants to discuss these tickets.",
    "Summarize the options and propose a batch; use the ask tool if a decision is needed.",
  ].join("\n");
}

/**
 * Orchestration prompt — grouped work items with instructions to delegate
 * independent domains to parallel subagents and sequence dependent items.
 *
 * Unlike `ask` mode (interactive dialog → selected batch), `orchestrate`
 * goes straight to a turn: the agent receives the full grouped roster and
 * decides the execution plan itself. The prompt instructs the agent to:
 *   1. Analyze cross-domain dependencies (shared files, API contracts).
 *   2. Spawn parallel subagents for independent domain batches.
 *   3. Sequence dependent items (P0 blockers before P1 consumers).
 *   4. Report a per-item verdict (done, blocked, needs-review).
 *
 * This is the "doing-things" mode for when the user wants the agent to
 * self-organize the work batch without an interactive selection step.
 */
export function buildOrchestratePrompt(
  labeled: LabeledTicket[],
  sources: WorkSources,
  directive: string,
): string {
  const batches = groupBatches(labeled);
  const domainSummary = [...batches.entries()]
    .map(([domain, items]) => `${domain} (${items.length})`)
    .join(", ");

  return [
    `Orchestrate work items discovered via /find-work (${labeled.length} items across ${batches.size} domains: ${domainSummary}).`,
    `Sources: ${describeSources(sources)}.`,
    "",
    "Work items grouped by domain:",
    renderList(labeled, true),
    "",
    "Execution plan — build it before touching code:",
    "1. Dependency analysis: identify cross-domain coupling (shared files, API contracts, migration ordering). Independent domains can run in parallel; coupled ones must sequence.",
    "2. Prioritize within each domain: P0 first, then P1, P2, P3. A P0 blocker in one domain may gate a P1 item in another.",
    "3. Parallel execution: for independent domain batches, spawn subagents (one per domain or per independent item) so work progresses concurrently. Each subagent works in its own worktree when the repo supports it (see /worktree).",
    "4. Sequential execution: for dependent items, complete the predecessor before starting the consumer. Do not start a consumer whose prerequisite is blocked.",
    "5. Per-item protocol: implement → verify with the repo's gate (e.g. `bun run verify`) → report verdict. Verdicts: done (implemented + verified), blocked (prerequisite unmet or external dependency), needs-review (ambiguous scope, user confirm required).",
    "6. Aggregation: after all subagents complete, summarize results per domain with verdict counts. Surface any blocked items with the blocking reason.",
    directive
      ? `User directive: ${directive}`
      : "Focus on bugs and small features first — defer epics unless explicitly requested.",
    "Stop for user confirm before any destructive operation (branch deletion, force push, schema migration). Report progress after each domain completes.",
  ].join("\n");
}

/**
 * Agent-turn fallback (no interactive ask surface, or zero handler-fetchable
 * tickets): the turn searches every detected source — including jira, glab,
 * and the worktree tracker CLI whose output shapes the handler never execs —
 * and presents via the ask tool, grouped by domain.
 */
export function buildFindWorkAgentPrompt(
  root: string,
  sources: WorkSources,
  directive: string,
): string {
  return [
    `Find actionable work items for the repo at ${root} and propose a batch.`,
    `Detected sources: ${describeSources(sources)}.`,
    "Search each available source (gh issue list, jira, git-issue list, .plan/ docs, the worktree tracker CLI, giwt ledger, giwt abnormal runs, TODO/FIXME comments, unmerged branches/worktrees, lint/typecheck/tests/knip/jscpd findings); skip the ones marked no.",
    directive ? `User directive: ${directive}` : "Collect open bugs and small features first.",
    "Present the result with the ask tool: one question per domain (tracker or primary label), options = tickets with id + one-line title, multi-select. After the ask, summarize the selected batch and await go-ahead before touching code.",
  ].join("\n");
}
