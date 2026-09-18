/**
 * `/bookkeep` — planning-hygiene dispatcher.
 *
 * Subcommands: `audit <epic|ticket>` (reconcile tracker claims against code),
 * `sync [--fix]` (verify the planning index), `find <query>` (locate items),
 * `issue <request>` (tracker operations via the detected backend),
 * `list` (enumerate discovered planning items),
 * `config` (dump resolved giwt/omp config: file, paths, branches, commands).
 *
 * The handler detects the tracking environment with fs checks only (no turn
 * spent) and bakes the facts into the turn prompt: in-repo `.plan/` + index
 * script first, then the repo worktree tracker CLI, then `gh`, then `jira`.
 * Bare `/bookkeep` answers read-only via `notify` (env summary + usage).
 *
 * Tab completions surface subcommand names, audit/sync/issue verb hints, and
 * planning-item IDs discovered from `.plan/{tickets,epics,backlog}` so the
 * user does not need to memorise slugs.
 *
 * Implementation lives in `./bookkeep/` — this file is the public surface.
 */

export { bookkeepCompletions } from "./bookkeep/completions";
export { discoverPlanningIds } from "./bookkeep/discover";
export type { BookkeepEnv } from "./bookkeep/env";
export { detectBookkeepEnv, onPath } from "./bookkeep/env";
export {
  bookkeepUsage,
  buildAuditPrompt,
  buildFindPrompt,
  buildIssuePrompt,
  buildListPrompt,
  buildSyncPrompt,
} from "./bookkeep/prompts";
export { registerBookkeep } from "./bookkeep/register";
