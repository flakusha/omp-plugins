/**
 * `/find-work` keyword tables, named regexes (named-tested-regexes rule:
 * anchored, tested), and tunable constants.
 */

import type { LabelScheme, TicketKind } from "./types";

// ---------------------------------------------------------------------------
// Named keyword tables + regexes (named-tested-regexes rule: anchored, tested)
// ---------------------------------------------------------------------------

export const MODE_KEYWORDS = ["list", "table", "ask", "orchestrate"] as const;
export const SCHEME_KEYWORDS: Record<string, LabelScheme> = {
  order: "order",
  letters: "letters",
  alpha: "letters",
  priorities: "priorities",
  priority: "priorities",
  prio: "priorities",
  types: "types",
  type: "types",
};
export const GROUP_KEYWORDS = ["batches", "batch", "grouped", "group"] as const;
export const KIND_KEYWORDS: Record<string, TicketKind> = {
  bugs: "bug",
  bug: "bug",
  features: "feature",
  feature: "feature",
  feat: "feature",
  epics: "epic",
  epic: "epic",
  tasks: "task",
  task: "task",
};
export const LIST_SUGAR_RE = /^list-(.+)$/;

/** gh / git-issue labels that decide kind or priority — never become domains. */
export const LABEL_KINDS: Record<string, TicketKind> = {
  bug: "bug",
  enhancement: "feature",
  feature: "feature",
  feat: "feature",
  epic: "epic",
};
export const LABEL_PRIORITY_RE = /^p([0-3])$/i;
export const LABEL_PRIORITY_PREFIX_RE = /^priority[:\s-]*p([0-3])$/i;
/** Severity-word ladder applied when no explicit P-label exists. */
export const SEVERITY_PRIORITIES: Record<string, string> = {
  critical: "P0",
  blocker: "P0",
  high: "P1",
  urgent: "P1",
  medium: "P2",
  normal: "P2",
  low: "P3",
  minor: "P3",
  trivial: "P3",
};
export const TITLE_KIND_PREFIX_RE = /^(fix|bug|feat|feature|epic|task)\s*[:-]\s*/i;
export const RECEIPT_ID_PREFIX_RE = /^([BFEI])(-\d+)?$/i;
/** `1. something` / `1 something` / `#12 something` list lines. */
export const NUMBERED_LINE_RE = /^\s*(?:#?(\d+)[.)]?\s+)(\S.*)$/;
export const HEADING_RE = /^#\s+(.+)$/;
export const STATUS_LINE_RE =
  /^\s*(?:[-*>]\s*)?(?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/i;
export const STATUS_DONE_RE =
  /^\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*|\[[^\]]*\]\s*|~~?\s*)*(done|fixed|complete[ds]?|closed|shipped|applied|finished|resolved|won'?t\s+(?:fix|do)|not-a-bug)\b/iu;
export const KEY_VALUE_RE = /^\s*([A-Za-z][\w-]*)\s*=\s*(.+)$/;

export const DEFAULT_PRIORITY = "P3";
export const MAX_TICKETS = 40;
export const MAX_TITLE = 80;
export const TABLE_TITLE = 60;
export const SOURCE_EXEC_TIMEOUT_MS = 15_000;
export const ASK_DIALOG_TIMEOUT_MS = 180_000;
/**
 * Wall-clock budget shared by the whole tool cluster (doctor + direct
 * fallback). giwt doctor runs its checks sequentially inside spawnSync with
 * no internal timeouts, so on large repos it cannot finish in any sane
 * budget — measured on loop-lore: full roster 435ms vs doctor >360s. When
 * the budget is consumed the cluster degrades to a warning (with the direct
 * command named) instead of blocking the roster for minutes.
 */
export const TOOL_CLUSTER_BUDGET_MS = 120_000;

// ---------------------------------------------------------------------------
// Tool-cluster tunables
// ---------------------------------------------------------------------------

/** Per-run timeouts (ms) for repo-health tools. */
export const LINT_TIMEOUT_MS = 45_000;
export const TYPECHECK_TIMEOUT_MS = 60_000;
export const TESTS_TIMEOUT_MS = 120_000;
export const KNIP_TIMEOUT_MS = 60_000;
export const JSCPD_TIMEOUT_MS = 90_000;

/** Max tickets surfaced per tool-cluster source. */
export const TOOL_MAX_TICKETS = 15;
