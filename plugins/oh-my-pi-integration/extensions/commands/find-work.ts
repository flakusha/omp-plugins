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
 *
 * Handler discipline (same as the other commands): read-only answers go to
 * `ctx.ui.notify` (no agent turn spent); doing-things go through
 * `pi.sendUserMessage`. Local subprocesses go through `pi.exec`, best-effort
 * with a user-visible warning per failed source — commands never break the
 * loop. jira/glab/worktree-tracker CLIs are detected but NOT exec'd from the
 * handler (output shape varies across CLI versions); they are surfaced in the
 * agent-fallback prompt instead, where the turn can probe each safely.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import type { ReceiptDoc } from "../receipt/receipt";
import { DEFAULT_STATE, parseReceipt } from "../receipt/receipt";
import { onPath } from "./bookkeep";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TicketKind = "bug" | "feature" | "epic" | "task";
export type WorkMode = "list" | "table" | "ask";
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
}

export interface FindWorkArgs {
  mode: WorkMode;
  scheme: LabelScheme;
  batches: boolean;
  kinds: TicketKind[];
  query: string;
}

export interface WorkSources {
  receipt: boolean;
  plan: boolean;
  gh: boolean;
  gitIssue: boolean;
  jira: boolean;
  glab: boolean;
  trackerCli: boolean;
}

export interface FetchResult {
  tickets: WorkTicket[];
  warnings: string[];
}

export interface LabeledTicket {
  ticket: WorkTicket;
  label: string;
}

// ---------------------------------------------------------------------------
// Named keyword tables + regexes (named-tested-regexes rule: anchored, tested)
// ---------------------------------------------------------------------------

export const MODE_KEYWORDS = ["list", "table", "ask"] as const;
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
export const STATUS_LINE_RE = /^\s*(?:[-*>]\s*)?status\s*[:=]\s*(.+)$/i;
export const STATUS_DONE_RE = /\b(done|complete[ds]?|closed|shipped|applied|finished|resolved)\b/i;
export const KEY_VALUE_RE = /^\s*([A-Za-z][\w-]*)\s*=\s*(.+)$/;

export const DEFAULT_PRIORITY = "P3";
export const MAX_TICKETS = 40;
export const MAX_TITLE = 80;
export const TABLE_TITLE = 60;
export const SOURCE_EXEC_TIMEOUT_MS = 15_000;
export const ASK_DIALOG_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Pure classification
// ---------------------------------------------------------------------------

/** Kind from a ticket's labels, then title prefix. Defaults to `task`. */
export function classifyKind(labels: string[], title: string): TicketKind {
  for (const label of labels) {
    const kind = LABEL_KINDS[label.toLowerCase()];
    if (kind) return kind;
  }
  const m = TITLE_KIND_PREFIX_RE.exec(title);
  if (m?.[1]) {
    const word = m[1].toLowerCase();
    if (word === "fix" || word === "bug") return "bug";
    if (word === "feat" || word === "feature") return "feature";
    if (word === "epic") return "epic";
    return "task";
  }
  return "task";
}

/** Priority from P-labels, `priority: PN` labels, then severity words. */
export function classifyPriority(labels: string[]): string {
  for (const label of labels) {
    const direct = LABEL_PRIORITY_RE.exec(label) ?? LABEL_PRIORITY_PREFIX_RE.exec(label);
    if (direct?.[1] !== undefined) return `P${direct[1]}`;
    const severity = SEVERITY_PRIORITIES[label.toLowerCase()];
    if (severity) return severity;
  }
  return DEFAULT_PRIORITY;
}

/** First label that is neither a kind nor a priority/severity marker. */
export function domainOf(labels: string[], fallbackSource: string): string {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (LABEL_KINDS[lower]) continue;
    if (LABEL_PRIORITY_RE.test(label) || LABEL_PRIORITY_PREFIX_RE.test(label)) continue;
    if (SEVERITY_PRIORITIES[lower]) continue;
    return lower;
  }
  return fallbackSource;
}

/** Receipt ledger ids (F-01, B-00, I-2 …) hint a kind by their letter prefix. */
export function kindFromReceiptId(id: string | undefined): TicketKind {
  const m = id ? RECEIPT_ID_PREFIX_RE.exec(id) : undefined;
  const letter = m?.[1]?.toUpperCase();
  if (letter === "B") return "bug";
  if (letter === "F") return "feature";
  if (letter === "E") return "epic";
  return "task";
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function normToken(token: string): string {
  return token.replace(/^--/, "").toLowerCase();
}

function applyKeyword(word: string, args: FindWorkArgs, modeExplicit: boolean): boolean {
  const scheme = SCHEME_KEYWORDS[word];
  if (scheme) {
    args.scheme = scheme;
    return true;
  }
  if ((GROUP_KEYWORDS as readonly string[]).includes(word)) {
    args.batches = true;
    return true;
  }
  const kind = KIND_KEYWORDS[word];
  if (kind) {
    if (!args.kinds.includes(kind)) args.kinds.push(kind);
    return true;
  }
  const sugar = LIST_SUGAR_RE.exec(word);
  if (sugar?.[1]) {
    if (!modeExplicit) args.mode = "list";
    return applyKeyword(sugar[1], args, true);
  }
  return false;
}

/** Usage error for a typo'd `list-*` variant. */
function unknownListSugar(rest: string): string {
  return (
    `unknown option 'list-${rest}' — valid variants: ` +
    "list-order, list-letters, list-priorities, list-types, list-batches, " +
    "list-bugs, list-features, list-epics, list-tasks"
  );
}

/**
 * Parse the option region. Mode keywords count only as the FIRST token, so a
 * directive that happens to start with a keyword-rich sentence after the mode
 * (`ask List bug items and propose…`) keeps its mode and treats the rest as
 * directive. Scheme/group/filter keywords are consumed until the first token
 * that matches none; everything from there is the directive.
 * Unknown `list-*` sugar is a hard error (typo guard with usage hint).
 */
export function parseFindWorkArgs(argv: string[]): { args: FindWorkArgs; error?: string } {
  const args: FindWorkArgs = {
    mode: "list",
    scheme: "order",
    batches: false,
    kinds: [],
    query: "",
  };
  if (argv.length === 0) return { args };

  let i = 0;
  const first = normToken(argv[0] ?? "");
  const firstSugar = LIST_SUGAR_RE.exec(first);
  if ((MODE_KEYWORDS as readonly string[]).includes(first)) {
    args.mode = first as WorkMode;
    i = 1;
  } else if (firstSugar?.[1]) {
    if (!applyKeyword(first, args, false)) {
      return { args, error: unknownListSugar(firstSugar[1]) };
    }
    i = 1;
  }

  for (; i < argv.length; i++) {
    const word = normToken(argv[i] ?? "");
    if (applyKeyword(word, args, (MODE_KEYWORDS as readonly string[]).includes(first))) continue;
    // A later mode word (or any unrecognized token) starts the directive —
    // e.g. `ask List bug items and propose…` keeps mode=ask and directive
    // "List bug items and propose…".
    args.query = argv.slice(i).join(" ");
    break;
  }
  return { args };
}

// ---------------------------------------------------------------------------
// Labeling, grouping, rendering
// ---------------------------------------------------------------------------

/** Bijective base-26 label: A..Z, AA, AB, … (unique for any count). */
export function letterLabel(seq: number): string {
  let n = seq + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Assign display labels per scheme. Unique for order/letters/types. */
export function labelTickets(tickets: WorkTicket[], scheme: LabelScheme): LabeledTicket[] {
  const kindCounters = new Map<TicketKind, number>();
  return tickets.map((ticket, seq) => {
    let label: string;
    if (scheme === "order") label = String(seq + 1);
    else if (scheme === "letters") label = letterLabel(seq);
    else if (scheme === "priorities") label = ticket.priority;
    else {
      const next = (kindCounters.get(ticket.kind) ?? 0) + 1;
      kindCounters.set(ticket.kind, next);
      label = `${ticket.kind[0]?.toUpperCase() ?? "T"}${next}`;
    }
    return { ticket, label };
  });
}

/** Group labeled tickets by domain, preserving first-appearance order. */
export function groupBatches(labeled: LabeledTicket[]): Map<string, LabeledTicket[]> {
  const groups = new Map<string, LabeledTicket[]>();
  for (const item of labeled) {
    const bucket = groups.get(item.ticket.domain);
    if (bucket) bucket.push(item);
    else groups.set(item.ticket.domain, [item]);
  }
  return groups;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function itemLine(item: LabeledTicket): string {
  const t = item.ticket;
  return `${item.label}. ${t.id} — ${clip(t.title, MAX_TITLE)} (${t.source}, ${t.kind}, ${t.priority})`;
}

/** Flat numbered list; `batches` inserts a header per domain. */
export function renderList(labeled: LabeledTicket[], batches: boolean): string {
  const sources = [...new Set(labeled.map((i) => i.ticket.source))];
  const lines = [`found ${labeled.length} open work item(s) (sources: ${sources.join(", ")})`];
  if (batches) {
    for (const [domain, items] of groupBatches(labeled)) {
      lines.push(`— ${domain} (${items.length}) —`);
      for (const item of items) lines.push(itemLine(item));
    }
  } else {
    for (const item of labeled) lines.push(itemLine(item));
  }
  return lines.join("\n");
}

/** Markdown table; `batches` prepends a domain column. */
export function renderTable(labeled: LabeledTicket[], batches: boolean): string {
  const header = batches
    ? ["domain", "label", "id", "title", "source", "kind", "prio"]
    : ["label", "id", "title", "source", "kind", "prio"];
  const lines = [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`];
  for (const { ticket, label } of labeled) {
    const cells = [
      ...(batches ? [ticket.domain] : []),
      label,
      ticket.id,
      clip(ticket.title, TABLE_TITLE),
      ticket.source,
      ticket.kind,
      ticket.priority,
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Exact option-label string used by both the ask dialog and the index. */
function askOptionLabel(item: LabeledTicket): string {
  return `${item.label} ${item.ticket.id} — ${clip(item.ticket.title, TABLE_TITLE)}`;
}

/**
 * Ask questions grouped by domain — one multi-select question per group,
 * options labeled `<label> <id> — <title>` (the exact string returned in
 * `selectedOptions`, so `buildLabelIndex` can map back to tickets).
 */
export function buildAskQuestions(labeled: LabeledTicket[]): ExtensionAskDialogQuestion[] {
  const questions: ExtensionAskDialogQuestion[] = [];
  for (const [domain, items] of groupBatches(labeled)) {
    questions.push({
      id: domain.replace(/[^a-z0-9-]+/g, "-") || "domain",
      header: domain,
      question: `Which ${domain} tickets should this batch take on?`,
      multi: true,
      options: items.map((item) => ({
        label: askOptionLabel(item),
        description: `${item.ticket.kind}, ${item.ticket.priority} (${item.ticket.source})`,
      })),
    });
  }
  return questions;
}

/** Map ask-dialog option labels back to their tickets. */
export function buildLabelIndex(labeled: LabeledTicket[]): Map<string, WorkTicket> {
  const index = new Map<string, WorkTicket>();
  for (const item of labeled) index.set(askOptionLabel(item), item.ticket);
  return index;
}

// ---------------------------------------------------------------------------
// Source detection + fetch layer
// ---------------------------------------------------------------------------

/** Pure fs/PATH detection of every work-source surface for a session cwd. */
export function detectWorkSources(root: string, pathEnv?: string): WorkSources {
  const env = pathEnv ?? process.env.PATH ?? "";
  const trackerCli = ["ticket", "issues", "prs", "gi"].some(
    (cmd) =>
      existsSync(join(root, `scripts/worktree/${cmd}.ts`)) ||
      existsSync(join(root, `scripts/worktree/${cmd}.mjs`)),
  );
  return {
    receipt: existsSync(join(root, ".omp", "receipt.toml")),
    plan: existsSync(join(root, ".plan")),
    gh: onPath("gh", env),
    gitIssue: onPath("git-issue", env) || onPath("gi", env),
    jira: onPath("jira", env),
    glab: onPath("glab", env),
    trackerCli,
  };
}

/** Any handler-fetchable source at all (jira/glab are turn-only). */
export function hasFetchableSource(sources: WorkSources): boolean {
  return sources.receipt || sources.plan || sources.gh || sources.gitIssue || sources.trackerCli;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** Environment summary used by usage output and the agent-fallback prompt. */
export function describeSources(sources: WorkSources): string {
  return (
    `receipt ${yesNo(sources.receipt)}; .plan ${yesNo(sources.plan)}; gh ${yesNo(sources.gh)}; ` +
    `git-issue ${yesNo(sources.gitIssue)}; jira ${yesNo(sources.jira)}; glab ${yesNo(sources.glab)}; ` +
    `worktree-tracker ${yesNo(sources.trackerCli)}`
  );
}

export function findWorkUsage(sources: WorkSources): string {
  return [
    "usage: /find-work [list|table|ask] [order|letters|priorities|types] [batches] " +
      "[bugs|features|epics|tasks] [directive...]",
    `sources: ${describeSources(sources)}`,
    "jira/glab are resolved inside an agent turn (use `/find-work ask` with a directive).",
  ].join("\n");
}

/** Value of the entry's first `key =` line inside the ledger, unquoted. */
function receiptEntryTitle(doc: ReceiptDoc, firstKey: string): string {
  for (const line of doc.lines) {
    const m = KEY_VALUE_RE.exec(line);
    if (m?.[1] === firstKey) {
      const raw = m[2] ?? "";
      const unquoted = raw.replace(/^"(.*)"$/, "$1").trim();
      if (unquoted) return unquoted;
    }
  }
  return firstKey;
}

/** Open (non-finished) ledger jobs become receipt tickets. */
export function receiptTickets(root: string): WorkTicket[] {
  const path = join(root, ".omp", "receipt.toml");
  if (!existsSync(path)) return [];
  const doc = parseReceipt(readFileSync(path, "utf8"));
  const tickets: WorkTicket[] = [];
  for (const entry of doc.entries) {
    if (entry.table !== "job" || !entry.firstKey) continue;
    const state = (entry.state ?? DEFAULT_STATE).trim().toLowerCase();
    if (state === "finished") continue;
    const title = receiptEntryTitle(doc, entry.firstKey);
    tickets.push({
      id: entry.firstKey,
      title,
      source: "receipt",
      kind: kindFromReceiptId(entry.firstKey),
      priority: DEFAULT_PRIORITY,
      domain: "receipt",
    });
  }
  return tickets;
}

const PLAN_DIRS: Array<{ dir: string; kind: TicketKind }> = [
  { dir: "tickets", kind: "task" },
  { dir: "epics", kind: "epic" },
  { dir: "backlog", kind: "task" },
];

/** Parse one `.plan/*.md` file into a ticket, or null when done/unreadable. */
function planFileTicket(
  abs: string,
  file: string,
  dir: string,
  kind: TicketKind,
): WorkTicket | null {
  const path = join(abs, file);
  let text: string;
  try {
    if (!statSync(path).isFile()) return null;
    text = readFileSync(path, "utf8").slice(0, 4096);
  } catch {
    return null;
  }
  const lines = text.split("\n");
  const heading = lines.find((line) => HEADING_RE.test(line));
  const id = file.replace(/\.md$/, "");
  const title = heading ? (HEADING_RE.exec(heading)?.[1] ?? "").trim() : id;
  const status = lines.find((line) => STATUS_LINE_RE.test(line));
  const statusValue = status ? (STATUS_LINE_RE.exec(status)?.[1] ?? "") : "";
  if (STATUS_DONE_RE.test(statusValue)) return null;
  return {
    id,
    title: title || id,
    source: ".plan",
    kind: classifyKind([], title) === "task" ? kind : classifyKind([], title),
    priority: DEFAULT_PRIORITY,
    domain: dir,
  };
}

/** `.plan/{tickets,epics,backlog}/*.md` — heading title, done-status skip. */
export function planTickets(root: string): WorkTicket[] {
  const tickets: WorkTicket[] = [];
  for (const { dir, kind } of PLAN_DIRS) {
    let files: string[];
    try {
      files = readdirSync(join(root, ".plan", dir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const ticket = planFileTicket(join(root, ".plan", dir), file, dir, kind);
      if (ticket) tickets.push(ticket);
    }
  }
  return tickets;
}

interface GhLabel {
  name?: string;
}
interface GhIssue {
  number?: number;
  title?: string;
  labels?: GhLabel[];
  url?: string;
}

/** gh issue list --json … → tickets. Throws on CLI/auth/network failure. */
export function parseGhIssues(stdout: string): WorkTicket[] {
  const issues = JSON.parse(stdout) as GhIssue[];
  return issues.map((issue) => {
    const id = `#${issue.number ?? "?"}`;
    const title = (issue.title ?? "").trim() || id;
    const labels = (issue.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
    return {
      id,
      title,
      source: "github",
      kind: classifyKind(labels, title),
      priority: classifyPriority(labels),
      domain: domainOf(labels, "github"),
      url: issue.url,
    };
  });
}

/** Tolerant line-parse of `git-issue list` output (`N. title` / `N title`). */
export function parseGitIssueList(stdout: string): WorkTicket[] {
  const tickets: WorkTicket[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = NUMBERED_LINE_RE.exec(line);
    if (!m) continue;
    const title = (m[2] ?? "").trim();
    if (!title) continue;
    tickets.push({
      id: `GI-${m[1]}`,
      title,
      source: "git-issue",
      kind: classifyKind([], title),
      priority: DEFAULT_PRIORITY,
      domain: "git-issue",
    });
  }
  return tickets;
}

interface ExecLike {
  exec(
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<{ stdout?: string }>;
}

/**
 * Fetch tickets from every handler-fetchable source. Per-source failures
 * become warnings; the rest of the sources still contribute. Result is
 * capped at MAX_TICKETS with a truncation warning.
 */
export async function fetchTickets(
  pi: ExecLike,
  root: string,
  sources: WorkSources,
): Promise<FetchResult> {
  const tickets: WorkTicket[] = [];
  const warnings: string[] = [];

  try {
    tickets.push(...receiptTickets(root));
  } catch {
    warnings.push("receipt ledger unreadable (.omp/receipt.toml malformed?)");
  }
  try {
    tickets.push(...planTickets(root));
  } catch {
    warnings.push(".plan scan failed");
  }
  if (sources.gh) {
    try {
      const res = await pi.exec(
        "gh",
        ["issue", "list", "--state", "open", "--limit", "30", "--json", "number,title,labels,url"],
        { timeout: SOURCE_EXEC_TIMEOUT_MS },
      );
      tickets.push(...parseGhIssues(res.stdout ?? ""));
    } catch {
      warnings.push("gh issue list failed (not a repo checkout, unauthenticated, or offline)");
    }
  }
  if (sources.gitIssue) {
    try {
      const res = await pi.exec("git-issue", ["list"], { timeout: SOURCE_EXEC_TIMEOUT_MS });
      const parsed = parseGitIssueList(res.stdout ?? "");
      if (parsed.length > 0) tickets.push(...parsed);
      else warnings.push("git-issue list returned no parseable items");
    } catch {
      warnings.push("git-issue list failed (not initialized in this repo?)");
    }
  }
  if (sources.trackerCli) {
    warnings.push("worktree tracker CLI detected — resolve via `/bookkeep` or an ask turn");
  }

  if (tickets.length > MAX_TICKETS) {
    warnings.push(`showing first ${MAX_TICKETS} of ${tickets.length} items`);
    return { tickets: tickets.slice(0, MAX_TICKETS), warnings };
  }
  return { tickets, warnings };
}

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
    "Search each available source (gh issue list, jira, git-issue list, .plan/ docs, the worktree tracker CLI); skip the ones marked no.",
    directive ? `User directive: ${directive}` : "Collect open bugs and small features first.",
    "Present the result with the ask tool: one question per domain (tracker or primary label), options = tickets with id + one-line title, multi-select. After the ask, summarize the selected batch and await go-ahead before touching code.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface AskCapableContext extends ExtensionCommandContext {
  ui: ExtensionCommandContext["ui"] & {
    askDialog?: (
      questions: ExtensionAskDialogQuestion[],
      dialogOptions?: { timeout?: number },
    ) => Promise<ExtensionAskDialogResult | undefined>;
  };
}

async function runAsk(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  root: string,
  sources: WorkSources,
  labeled: LabeledTicket[],
  args: FindWorkArgs,
): Promise<void> {
  if (typeof ctx.ui.askDialog === "function") {
    const index = buildLabelIndex(labeled);
    const result = await ctx.ui.askDialog(buildAskQuestions(labeled), {
      timeout: ASK_DIALOG_TIMEOUT_MS,
    });
    if (result === undefined) {
      ctx.ui.notify("find-work: cancelled", "info");
      return;
    }
    if (result.kind === "chat") {
      await pi.sendUserMessage(buildChatPrompt(labeled, args.query));
      return;
    }
    const selected = result.results
      .flatMap((r) => r.selectedOptions)
      .map((label) => index.get(label))
      .filter((t): t is WorkTicket => t !== undefined);
    if (selected.length === 0) {
      ctx.ui.notify("find-work: no tickets selected", "info");
      return;
    }
    await pi.sendUserMessage(buildSelectedPrompt(selected, args.query));
    return;
  }
  // No interactive ask surface (print/RPC mode, or dialogs unsupported):
  // let the turn search and present via the agent-side ask tool instead.
  await pi.sendUserMessage(buildFindWorkAgentPrompt(root, sources, args.query));
}

/** Fetch, filter, and present — everything after argument parsing. */
async function presentFindWork(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  root: string,
  parsed: FindWorkArgs,
  tickets: WorkTicket[],
): Promise<void> {
  const sources = detectWorkSources(root);
  const filtered = filterTickets(
    tickets,
    // In ask mode the query is the turn directive, never a result filter.
    parsed.mode === "ask" ? { ...parsed, query: "" } : parsed,
  );
  if (filtered.length === 0) {
    // Ask mode with nothing fetched still serves the user: sources the
    // handler cannot exec (jira, glab, tracker CLI) are resolved by the
    // agent turn instead of dead-ending on a miss notice.
    if (parsed.mode === "ask") {
      await pi.sendUserMessage(buildFindWorkAgentPrompt(root, sources, parsed.query));
      return;
    }
    const suffix = parsed.query ? ` matching '${parsed.query}'` : "";
    ctx.ui.notify(`no open work items found${suffix}`, "info");
    return;
  }
  const labeled = labelTickets(filtered, parsed.scheme);
  if (parsed.mode === "ask") {
    await runAsk(pi, ctx, root, sources, labeled, parsed);
    return;
  }
  ctx.ui.notify(
    parsed.mode === "table"
      ? renderTable(labeled, parsed.batches)
      : renderList(labeled, parsed.batches),
    "info",
  );
}

/** Parse, detect sources, fetch best-effort, then present. */
async function runFindWork(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  argv: string[],
): Promise<void> {
  const { args: parsed, error } = parseFindWorkArgs(argv);
  if (error) {
    ctx.ui.notify(error, "error");
    return;
  }
  const root = ctx.cwd;
  const sources = detectWorkSources(root);
  if (argv.length === 0 && !hasFetchableSource(sources)) {
    ctx.ui.notify(findWorkUsage(sources), "info");
    return;
  }
  const { tickets, warnings } = await fetchTickets(pi, root, sources);
  for (const warning of warnings) ctx.ui.notify(warning, "warning");
  await presentFindWork(pi, ctx, root, parsed, tickets);
}

/** Register `/find-work` on the plugin factory's `pi`. */
export function registerFindWork(pi: ExtensionAPI): void {
  pi.registerCommand("find-work", {
    description:
      "Find actionable tickets across trackers: " +
      "/find-work [list|table|ask] [order|letters|priorities|types] [batches] [bugs|features|epics|tasks] [directive...]",
    handler: async (args, ctx) => {
      await runFindWork(pi, ctx as AskCapableContext, args.trim().split(/\s+/).filter(Boolean));
    },
  });
}
