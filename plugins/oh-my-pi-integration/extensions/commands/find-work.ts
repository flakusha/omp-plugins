/**
 * `/find-work` — discover actionable work items across repo tooling and
 * external trackers, presented as a flat list, a table, or an interactive
 * ask dialog grouped by domain.
 *
 * Grammar:
 *   /find-work [mode] [scheme] [grouping] [kind-filters] [directive...]
 *   mode:    list (default) | table | ask          (mode keyword only counts
 *            as the first token — later occurrences become directive text)
 *   scheme:  order (1,2,3, default) | letters (A,B,C) |
 *            priorities (P0..P3) | types (B1,F1,E1,T1)
 *   grouping: batches (section per domain; ask mode always groups by domain)
 *   filters: bugs | features | epics | tasks
 *   directive: remaining free text — list/table: substring filter over
 *            id+title; ask: directive carried into the follow-up turn
 *
 * Hyphenated sugar is accepted anywhere in the option region:
 * `list-order`, `list-letters`, `list-priorities`, `list-types`,
 * `list-batches`, `list-bugs`, `list-features`, `list-epics`, `list-tasks`
 * (each also implies mode=list when no explicit mode was given).
 * `.plan/` tickets and epics read labels from YAML frontmatter `labels:`,
 * a `**Labels:**` header, or a `**Tags:**` header (alias) — same kind /
 * priority / domain classification as gh labels (see util/plan-frontmatter).
 *
 * Handler discipline (same as the other commands): read-only answers go to
 * `ctx.ui.notify` (no agent turn spent); doing-things go through
 * `pi.sendUserMessage`. Local subprocesses go through `pi.exec`, best-effort
 * with a user-visible warning per failed source — commands never break the
 * loop. jira/glab/worktree-tracker CLIs are detected but NOT exec'd from the
 * handler (output shape varies across CLI versions); they are surfaced in the
 * agent-fallback prompt instead, where the turn can probe each safely.
 *
 * Implementation lives in ./find-work/* — this entry is the public
 * re-export surface (tests and the extension registry import from here)
 * plus nothing else; `registerFindWork` wires the command.
 */

// Pure classification.
export { classifyKind, classifyPriority, domainOf, kindFromReceiptId } from "./find-work/classify";
export type { DoctorCheck } from "./find-work/doctor";
// giwt doctor bridge + tool-cluster orchestration.
export {
  DOCTOR_TIMEOUT_MS,
  fetchViaDoctor,
  mapDoctorReport,
  parseDoctorReport,
} from "./find-work/doctor";
// Fetch orchestration across all sources.
export { type FetchOpts, fetchTickets } from "./find-work/fetch";
// Tab completions + command registration.
export { FIND_WORK_SUGAR, findWorkCompletions, registerFindWork } from "./find-work/handler";
// Keyword tables, named regexes, tunables.
// Search/flag vocabulary.
export {
  ASK_DIALOG_TIMEOUT_MS,
  DEFAULT_PRIORITY,
  DIRECTIVE_FLAG_RE,
  FAST_FLAG_RE,
  GROUP_KEYWORDS,
  HEADING_RE,
  JSCPD_TIMEOUT_MS,
  KEY_VALUE_RE,
  KIND_KEYWORDS,
  KNIP_TIMEOUT_MS,
  LABEL_KINDS,
  LABEL_PRIORITY_PREFIX_RE,
  LABEL_PRIORITY_RE,
  LINT_TIMEOUT_MS,
  LIST_SUGAR_RE,
  MAX_TICKETS,
  MAX_TITLE,
  MODE_KEYWORDS,
  NUMBERED_LINE_RE,
  PLAN_EPIC_HEADER_RE,
  RECEIPT_ID_PREFIX_RE,
  SCHEME_KEYWORDS,
  SEARCH_FLAG_RE,
  SEARCH_MAX_TICKETS,
  SEVERITY_PRIORITIES,
  SOURCE_EXEC_TIMEOUT_MS,
  STATUS_DONE_RE,
  STATUS_LINE_RE,
  TABLE_TITLE,
  TESTS_TIMEOUT_MS,
  TITLE_KIND_PREFIX_RE,
  TOOL_CLUSTER_BUDGET_MS,
  TOOL_MAX_TICKETS,
  TYPECHECK_TIMEOUT_MS,
} from "./find-work/keywords";
// Knip + jscpd cluster.
export type { CloneFinding, KnipFinding } from "./find-work/knip-jscpd";
export { parseJscpdReport, parseKnipIssues } from "./find-work/knip-jscpd";
// Lint cluster (eslint / biome / oxlint).
export type { BiomeFinding, EslintFinding, OxlintFinding } from "./find-work/lint";
export { parseBiomeOutput, parseEslintJson, parseOxlintJson } from "./find-work/lint";
// Merge-queue scan (pure parsers + live git fetch).
export type { DirtyStat, MergeBranch, MergeWorktree } from "./find-work/merge-parse";
export {
  parseBranchLines,
  parseMergeBase,
  parseRevCounts,
  parseStatusShort,
  parseWorktreePorcelain,
} from "./find-work/merge-parse";
export { fetchMergeTickets, MERGE_MAX_BRANCHES, MERGE_MAX_TICKETS } from "./find-work/merge-queue";
// Argument parsing.
export { parseFindWorkArgs } from "./find-work/parse-args";
// Patch-review roster source (dirty tree → perf/bughunt review item).
export type { PatchCounts, PatchStat } from "./find-work/patch-review";
export {
  buildPatchTicket,
  fetchPatchReviewTickets,
  PATCH_BRANCH_RE,
  parsePatchCounts,
  parseShortstat,
} from "./find-work/patch-review";
// Directive filtering + turn prompts.
export {
  buildChatPrompt,
  buildFindWorkAgentPrompt,
  buildOrchestratePrompt,
  buildSelectedPrompt,
  filterTickets,
} from "./find-work/prompts";
// Labeling, grouping, rendering.
export {
  buildAskQuestions,
  buildLabelIndex,
  groupBatches,
  labelTickets,
  letterLabel,
  renderList,
  renderTable,
} from "./find-work/render";
// Roster ticket sources (receipt / .plan / gh / git-issue / giwt).
export {
  giwtLedgerTickets,
  giwtRunTickets,
  parseGhIssues,
  parseGitIssueList,
  planTickets,
  receiptTickets,
} from "./find-work/roster";
// `-s` tiered search extension (direct / fuzzy / connections).
export type { SearchHit } from "./find-work/search";
export { epicRefIndex, searchTickets } from "./find-work/search";
export type { LintTool } from "./find-work/sources";
// Source detection + usage summaries.
export {
  describeSources,
  detectLintTool,
  detectWorkSources,
  findWorkUsage,
  hasFetchableSource,
  hasGitRepo,
  hasJscpd,
  hasKnip,
  hasTestScript,
  hasTodoSource,
} from "./find-work/sources";
export type { TodoMatch } from "./find-work/todo-scan";
// TODO/FIXME comment scan.
export {
  TODO_MARKER_RE,
  TODO_MAX_FILE_BYTES,
  TODO_MAX_FILES,
  TODO_MAX_TICKETS,
  todoCommentText,
  todoTickets,
} from "./find-work/todo-scan";
export type { ToolClusterOpts } from "./find-work/tool-cluster";
export { fetchToolTickets } from "./find-work/tool-cluster";
// Typecheck + tests cluster.
export type { TestFailure, TscError } from "./find-work/typecheck-tests";
export { parseTestOutput, parseTscOutput } from "./find-work/typecheck-tests";
// Core types (tickets, args, sources, fetch results).
export type {
  FetchResult,
  FindWorkArgs,
  LabeledTicket,
  LabelScheme,
  TicketKind,
  WorkMode,
  WorkSources,
  WorkTicket,
} from "./find-work/types";
