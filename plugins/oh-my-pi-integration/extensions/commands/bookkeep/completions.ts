/** Tab completion for `/bookkeep` arguments. */

import { discoverPlanningIds } from "./discover";
import type { BookkeepEnv } from "./env";

const BOOKKEEP_SUBCOMMANDS = ["audit", "sync", "find", "issue", "list", "config"] as const;
/** Verbs the `issue` subcommand commonly takes; pure suffix hints. */
const ISSUE_VERBS = ["list", "view", "search", "create", "close", "comment", "assign"];

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
    case "config":
      return [];
    default:
      return BOOKKEEP_SUBCOMMANDS.filter((s) => s.startsWith(lastPrefix));
  }
}
