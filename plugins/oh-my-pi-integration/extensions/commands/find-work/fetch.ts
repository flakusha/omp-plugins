/**
 * `/find-work` fetch orchestration: pull tickets from every handler-
 * fetchable source, converting per-source failures into warnings while the
 * remaining sources still contribute.
 */

import { SOURCE_EXEC_TIMEOUT_MS } from "./keywords";
import { fetchMergeTickets } from "./merge-queue";
import { fetchPatchReviewTickets } from "./patch-review";
import {
  giwtLedgerTickets,
  giwtRunTickets,
  parseGhIssues,
  parseGitIssueList,
  planTickets,
  receiptTickets,
} from "./roster";
import { todoTickets } from "./todo-scan";
import { fetchToolTickets } from "./tool-cluster";
import type { ExecLike } from "./tool-exec";
import type { FetchResult, WorkSources, WorkTicket } from "./types";

/**
 * Fetch tickets from every handler-fetchable source. Per-source failures
 * become warnings; the rest of the sources still contribute. Uncapped —
 * the caller filters and caps (see presentFindWork).
 *
 * Independent async sources (gh, git-issue, merges, patch review, tool
 * cluster) run concurrently; sync roster sources run inline. Results are
 * concatenated in a fixed order (sync roster, then gh, git-issue, merges,
 * patch review, tools) so output stays deterministic regardless of
 * completion order.
 */
export interface FetchOpts {
  /** `--fast` (or `-s`, which implies it): skip the live tool cluster. */
  fast?: boolean;
}

export async function fetchTickets(
  pi: ExecLike,
  root: string,
  sources: WorkSources,
  opts?: FetchOpts,
): Promise<FetchResult> {
  // Fast mode masks the tool-cluster sources — the "full repo check" — while
  // every roster source (receipt/.plan/gh/git-issue/giwt/todo/merges/patch)
  // still contributes. Never silently skipped: runFindWork notifies.
  const effective: WorkSources = opts?.fast
    ? { ...sources, lint: false, typecheck: false, tests: false, knip: false, jscpd: false }
    : sources;
  const tickets: WorkTicket[] = [];
  const warnings: string[] = [];

  try {
    tickets.push(...receiptTickets(root));
  } catch {
    warnings.push("receipt ledger unreadable (receipt.toml malformed?)");
  }
  try {
    tickets.push(...planTickets(root));
  } catch {
    warnings.push(".plan scan failed");
  }
  // TODO(perf): per-command hot path. The async sources below are independent
  // I/O-bound subprocesses and run concurrently (slots); the sync roster scan
  // stays inline. Rejected for now: a prebuilt SQLite/mtime index for the
  // roster — measured 35ms planTickets (1829 files) + 11ms todoTickets
  // (600-file cap) on loop-lore, far below perceptibility; revisit when
  // planTickets exceeds ~1s or the corpus grows ~5×.
  interface Slot {
    tickets: WorkTicket[];
    warning?: string;
  }
  const slots: Array<Promise<Slot>> = [];
  if (effective.gh) {
    slots.push(
      (async (): Promise<Slot> => {
        try {
          const res = await pi.exec(
            "gh",
            [
              "issue",
              "list",
              "--state",
              "open",
              "--limit",
              "30",
              "--json",
              "number,title,labels,url",
            ],
            { timeout: SOURCE_EXEC_TIMEOUT_MS },
          );
          return { tickets: parseGhIssues(res.stdout ?? "") };
        } catch {
          return {
            tickets: [],
            warning: "gh issue list failed (not a repo checkout, unauthenticated, or offline)",
          };
        }
      })(),
    );
  }
  if (effective.gitIssue) {
    slots.push(
      (async (): Promise<Slot> => {
        try {
          const res = await pi.exec("git-issue", ["ls"], { timeout: SOURCE_EXEC_TIMEOUT_MS });
          const parsed = parseGitIssueList(res.stdout ?? "");
          if (parsed.length > 0) return { tickets: parsed };
          return { tickets: [], warning: "git-issue ls returned no parseable items" };
        } catch {
          return { tickets: [], warning: "git-issue ls failed (not initialized in this repo?)" };
        }
      })(),
    );
  }
  if (effective.trackerCli) {
    warnings.push("worktree tracker CLI detected — resolve via `/bookkeep` or an ask turn");
  }
  if (effective.giwtLedger) {
    try {
      const giwtTickets = giwtLedgerTickets(root);
      if (giwtTickets.length > 0) tickets.push(...giwtTickets);
      else warnings.push("giwt ledger empty (.ledger.jsonl has no records)");
    } catch {
      warnings.push("giwt ledger unreadable (.ledger.jsonl malformed?)");
    }
  }
  if (effective.giwtRuns) {
    try {
      const runTickets = giwtRunTickets(root);
      if (runTickets.length > 0) tickets.push(...runTickets);
    } catch {
      warnings.push("giwt run records scan failed");
    }
  }
  if (effective.todo) {
    try {
      const found = todoTickets(root);
      if (found.length > 0) tickets.push(...found);
    } catch {
      warnings.push("TODO comment scan failed");
    }
  }
  // Merges and the tool cluster are async; their slots sit after the sync
  // sources in concat order (gh, git-issue, merges, tools) — deterministic
  // regardless of which resolves first.
  if (effective.merges) {
    slots.push(
      fetchMergeTickets(pi, root).then(
        (t) => ({ tickets: t }),
        (): Slot => ({ tickets: [], warning: "git branch/worktree scan failed (not a git repo?)" }),
      ),
    );
  }
  if (effective.patches) {
    slots.push(
      fetchPatchReviewTickets(pi, root).then(
        (t) => ({ tickets: t }),
        (): Slot => ({ tickets: [], warning: "patch review scan failed (not a git repo?)" }),
      ),
    );
  }
  if (
    effective.lint ||
    effective.typecheck ||
    effective.tests ||
    effective.knip ||
    effective.jscpd
  ) {
    slots.push(
      fetchToolTickets(pi, root, sources).then(
        (t) => ({
          tickets: t.tickets,
          warning: t.warnings.length > 0 ? t.warnings.join("; ") : undefined,
        }),
        (): Slot => ({ tickets: [], warning: "tool findings failed" }),
      ),
    );
  }

  for (const slot of await Promise.all(slots)) {
    tickets.push(...slot.tickets);
    if (slot.warning) warnings.push(slot.warning);
  }
  return { tickets, warnings };
}
