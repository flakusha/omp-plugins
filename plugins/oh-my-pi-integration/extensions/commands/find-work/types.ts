/**
 * Core `/find-work` shared types: tickets, parsed args, detected sources,
 * fetch results, and the tool-cluster result shape.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TicketKind = "bug" | "feature" | "epic" | "task";
export type WorkMode = "list" | "table" | "ask" | "orchestrate";
export type LabelScheme = "order" | "letters" | "priorities" | "types";

export interface WorkTicket {
  /** Tracker id as displayed to the user (`#12`, `GI-3`, `F-02`, file stem). */
  id: string;
  title: string;
  /** Source key: `github`, `git-issue`, `.plan`, `receipt`. */
  source: string;
  kind: TicketKind;
  /** `P0`..`P3`; unknown severity defaults to P3. */
  priority: string;
  /** Grouping key for batches and ask questions (label, else source). */
  domain: string;
  url?: string;
  /** Label/tag tokens (plan labels, gh labels) — `-s` tag search input. */
  tags?: string[];
  /** `.plan` `**Epic:**` binding — `-s` connected-item search input. */
  epic?: string;
  /** Search-match provenance annotation (`tag:perf`, `fuzzy`, `epic:EPIC-4`). */
  matchedVia?: string;
}

export interface FindWorkArgs {
  mode: WorkMode;
  scheme: LabelScheme;
  batches: boolean;
  kinds: TicketKind[];
  query: string;
  /** `-s` fuzzy search request — tiered tag/candidate/connection search. */
  search?: string;
  /** `-m`/`-d` user directive (with approach recommendation). */
  directive?: string;
  /** `--fast` (implied by `-s`): skip live tool findings. */
  fast?: boolean;
}

export interface WorkSources {
  receipt: boolean;
  plan: boolean;
  gh: boolean;
  gitIssue: boolean;
  jira: boolean;
  glab: boolean;
  trackerCli: boolean;
  giwtLedger: boolean;
  giwtRuns: boolean;
  todo: boolean;
  merges: boolean;
  /** Dirty working tree — patch-review source (perf & bughunting pass). */
  patches: boolean;
  lint: boolean;
  typecheck: boolean;
  tests: boolean;
  knip: boolean;
  jscpd: boolean;
}

export interface FetchResult {
  tickets: WorkTicket[];
  warnings: string[];
}

export interface LabeledTicket {
  ticket: WorkTicket;
  label: string;
}

/** Tool-cluster fetch result: findings plus per-source warnings. */
export interface ToolFetch {
  tickets: WorkTicket[];
  warnings: string[];
}
