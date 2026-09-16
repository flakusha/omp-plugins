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
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import { readGiwtLedger } from "../receipt/giwt-bridge";
import type { ReceiptDoc } from "../receipt/receipt";
import { DEFAULT_STATE, parseReceipt } from "../receipt/receipt";
import { resolveGiwtConfig, resolvePlanDir } from "../util/giwt-config";
import { readPlanLabels } from "../util/plan-frontmatter";
import { onPath } from "./bookkeep";
import { argumentItems } from "./completions";

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
  giwtLedger: boolean;
  giwtRuns: boolean;
  todo: boolean;
  merges: boolean;
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

interface PkgJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  knip?: unknown;
}

/** Best-effort package.json read; null when absent/unparseable. */
function pkgJsonOf(root: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PkgJson;
  } catch {
    return null;
  }
}

function hasDep(pkg: PkgJson | null, name: string): boolean {
  return (
    typeof pkg?.dependencies?.[name] === "string" ||
    typeof pkg?.devDependencies?.[name] === "string"
  );
}

/** Inside a git checkout (normal `.git` dir or linked-worktree `.git` file). */
export function hasGitRepo(root: string): boolean {
  // existsSync never throws — no try/catch needed.
  return existsSync(join(root, ".git"));
}

export type LintTool = "eslint" | "biome" | "oxlint";

const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  ".eslintrc.js",
  ".eslintrc.cjs",
];

/** Configured linter, eslint first (most specific config wins ties). */
export function detectLintTool(root: string): LintTool | null {
  if (ESLINT_CONFIGS.some((f) => existsSync(join(root, f)))) return "eslint";
  if (existsSync(join(root, "biome.json")) || existsSync(join(root, "biome.jsonc"))) {
    return "biome";
  }
  if (existsSync(join(root, ".oxlintrc.json"))) return "oxlint";
  const pkg = pkgJsonOf(root);
  if (pkg && (hasDep(pkg, "oxlint") || typeof pkg.scripts?.["oxlint"] === "string")) {
    return "oxlint";
  }
  return null;
}

/** Repo opts into test runs via a `test` script. */
export function hasTestScript(root: string): boolean {
  return typeof pkgJsonOf(root)?.scripts?.["test"] === "string";
}

const KNIP_CONFIGS = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.js",
  "knip.ts",
  "knip.config.js",
  "knip.config.ts",
];

/** Knip opted in via config file, package.json#knip, or dependency. */
export function hasKnip(root: string): boolean {
  if (KNIP_CONFIGS.some((f) => existsSync(join(root, f)))) return true;
  const pkg = pkgJsonOf(root);
  if (!pkg) return false;
  return pkg.knip !== undefined || hasDep(pkg, "knip");
}

const JSCPD_CONFIGS = [".jscpd.json", ".jscpdrc", ".jscpdrc.json", "jscpd.json"];

/** Jscpd opted in via config file, dependency, or npm script. */
export function hasJscpd(root: string): boolean {
  if (JSCPD_CONFIGS.some((f) => existsSync(join(root, f)))) return true;
  const pkg = pkgJsonOf(root);
  if (!pkg) return false;
  return (
    hasDep(pkg, "jscpd") || Object.values(pkg.scripts ?? {}).some((cmd) => /\bjscpd\b/.test(cmd))
  );
}

/** Pure fs/PATH detection of every work-source surface for a session cwd. */
export function detectWorkSources(root: string, pathEnv?: string): WorkSources {
  const env = pathEnv ?? process.env.PATH ?? "";
  const trackerCli = ["ticket", "issues", "prs", "gi"].some(
    (cmd) =>
      existsSync(join(root, `scripts/worktree/${cmd}.ts`)) ||
      existsSync(join(root, `scripts/worktree/${cmd}.mjs`)),
  );
  const giwtConfig = resolveGiwtConfig(root);
  return {
    receipt: existsSync(giwtConfig.receiptPath),
    plan: existsSync(giwtConfig.planDir),
    gh: onPath("gh", env),
    gitIssue: onPath("git-issue", env) || onPath("gi", env),
    jira: onPath("jira", env),
    glab: onPath("glab", env),
    trackerCli,
    giwtLedger: giwtConfig.available && existsSync(giwtConfig.ledgerPath),
    giwtRuns: giwtConfig.available && existsSync(giwtConfig.runlogDir),
    todo: hasTodoSource(root),
    merges: hasGitRepo(root) && onPath("git", env),
    lint: detectLintTool(root) !== null,
    typecheck: existsSync(join(root, "tsconfig.json")),
    tests: hasTestScript(root),
    knip: hasKnip(root),
    jscpd: hasJscpd(root),
  };
}

/** Any handler-fetchable source at all (jira/glab are turn-only). */
export function hasFetchableSource(sources: WorkSources): boolean {
  return (
    sources.receipt ||
    sources.plan ||
    sources.gh ||
    sources.gitIssue ||
    sources.trackerCli ||
    sources.giwtLedger ||
    sources.giwtRuns ||
    sources.todo ||
    sources.merges ||
    sources.lint ||
    sources.typecheck ||
    sources.tests ||
    sources.knip ||
    sources.jscpd
  );
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** Environment summary used by usage output and the agent-fallback prompt. */
export function describeSources(sources: WorkSources): string {
  return (
    `receipt ${yesNo(sources.receipt)}; .plan ${yesNo(sources.plan)}; gh ${yesNo(sources.gh)}; ` +
    `git-issue ${yesNo(sources.gitIssue)}; jira ${yesNo(sources.jira)}; glab ${yesNo(sources.glab)}; ` +
    `worktree-tracker ${yesNo(sources.trackerCli)}; giwt-ledger ${yesNo(sources.giwtLedger)}; giwt-runs ${yesNo(sources.giwtRuns)}; ` +
    `todo ${yesNo(sources.todo)}; merges ${yesNo(sources.merges)}; lint ${yesNo(sources.lint)}; ` +
    `typecheck ${yesNo(sources.typecheck)}; tests ${yesNo(sources.tests)}; knip ${yesNo(sources.knip)}; jscpd ${yesNo(sources.jscpd)}`
  );
}

export function findWorkUsage(sources: WorkSources): string {
  return [
    "usage: /find-work [list|table|ask|orchestrate] [order|letters|priorities|types] [batches] " +
      "[bugs|features|epics|tasks] [directive...]",
    `sources: ${describeSources(sources)}`,
    "orchestrate: auto-delegate items to parallel subagents grouped by domain.",
    "tool findings (lint/typecheck/tests/knip/jscpd), TODO comments, and unmerged branches run live when detected.",
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
  const path = resolveGiwtConfig(root).receiptPath;
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

const PLAN_DIRS: Array<{ dir: "tickets" | "epics" | "backlog"; kind: TicketKind }> = [
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
  const labels = readPlanLabels(text);
  const status = lines.find((line) => STATUS_LINE_RE.test(line));
  const statusValue = status ? (STATUS_LINE_RE.exec(status)?.[1] ?? "") : "";
  if (STATUS_DONE_RE.test(statusValue)) return null; // labels never bypass done-detection
  const fromMeta = classifyKind(labels, title);
  return {
    id,
    title: title || id,
    source: ".plan",
    // Dir default applies only when labels/title yield no stronger kind.
    kind: fromMeta === "task" ? kind : fromMeta,
    priority: classifyPriority(labels),
    domain: domainOf(labels, dir),
  };
}

/** `.plan/{tickets,epics,backlog}/*.md` — heading title, done-status skip. */
export function planTickets(root: string): WorkTicket[] {
  const tickets: WorkTicket[] = [];
  for (const { dir, kind } of PLAN_DIRS) {
    const abs = resolvePlanDir(root, dir);
    let files: string[];
    try {
      files = readdirSync(abs);
    } catch {
      continue;
    }
    files.sort(); // deterministic order — readdirSync returns fs-hash order
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const ticket = planFileTicket(abs, file, dir, kind);
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

/**
 * giwt ledger records become work tickets. Each `.ledger.jsonl` record
 * represents a CLI invocation with optional `--say` context. Records
 * carrying `::` (say-annotated) are richer work signals; bare command
 * records are lower signal but still surface recent agent activity.
 */
export function giwtLedgerTickets(root: string): WorkTicket[] {
  const giwtConfig = resolveGiwtConfig(root);
  if (!giwtConfig.available) return [];
  const entries = readGiwtLedger(giwtConfig.treeDir);
  const tickets: WorkTicket[] = [];
  for (const entry of entries) {
    const hasSay = entry.summary.includes("::");
    const title = hasSay
      ? entry.summary.split("::").slice(1).join("::").trim() || entry.summary
      : entry.summary;
    tickets.push({
      id: entry.id,
      title: title || `${entry.cmd} ${entry.branch}`,
      source: "giwt-ledger",
      kind: "task",
      priority: hasSay ? "P2" : "P3",
      domain: `giwt:${entry.cmd}`,
    });
  }
  return tickets;
}

/**
 * giwt run records with abnormal termination (missing end/exitCode in
 * meta.json) become high-priority bug candidates. Each run dir under
 * `.tmp/giwt/runs/` has a `meta.json` — a record without `end` means
 * the process was killed or exited abnormally.
 */
export function giwtRunTickets(root: string): WorkTicket[] {
  const giwtConfig = resolveGiwtConfig(root);
  if (!giwtConfig.available) return [];
  const runsDir = join(giwtConfig.runlogDir, "runs");
  if (!existsSync(runsDir)) return [];

  let dirs: string[];
  try {
    dirs = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse(); // newest first
  } catch {
    return [];
  }

  const tickets: WorkTicket[] = [];
  for (const dir of dirs.slice(0, 15)) {
    const metaPath = join(runsDir, dir, "meta.json");
    if (!existsSync(metaPath)) continue;
    let meta: { cmd?: string; args?: string[]; branch?: string; end?: string; exitCode?: number };
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      continue;
    }
    // Only abnormal terminations (no end/exitCode) are work items
    if (meta.end && meta.exitCode !== undefined) continue;
    const cmd = meta.cmd ?? "unknown";
    const argStr = (meta.args ?? []).join(" ");
    const runId = dir.replace(/.*-/, "");
    tickets.push({
      id: `GR-${runId}`,
      title: `Abnormal exit: giwt ${cmd} ${argStr}`.trim(),
      source: "giwt-run",
      kind: "bug",
      priority: "P1",
      domain: "abnormal-runs",
    });
  }
  return tickets;
}

// ---------------------------------------------------------------------------
// TODO/FIXME comment scan
// ---------------------------------------------------------------------------

/** Comment markers that become work tickets (word-boundary, case-insensitive). */
export const TODO_MARKER_RE = /\b(TODO|FIXME)\b/i;

/** File extensions scanned for TODO/FIXME comments (code + scripts + styles). */
const TODO_EXTS: Record<string, true> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".jsx": true,
  ".mjs": true,
  ".cjs": true,
  ".mts": true,
  ".cts": true,
  ".py": true,
  ".go": true,
  ".rs": true,
  ".java": true,
  ".kt": true,
  ".rb": true,
  ".php": true,
  ".swift": true,
  ".c": true,
  ".h": true,
  ".cpp": true,
  ".hpp": true,
  ".cs": true,
  ".sh": true,
  ".bash": true,
  ".zsh": true,
  ".css": true,
  ".scss": true,
  ".html": true,
  ".vue": true,
  ".svelte": true,
  ".sql": true,
  ".lua": true,
};

/** Directories never descended into (deps, build output, VCS, scratch). */
const TODO_SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  target: true,
  dist: true,
  build: true,
  ".next": true,
  ".nuxt": true,
  coverage: true,
  vendor: true,
  ".venv": true,
  venv: true,
  __pycache__: true,
  ".turbo": true,
  ".parcel-cache": true,
  ".tmp": true,
  ".plan": true,
  ".omp": true,
  ".serena": true,
  ".vscode": true,
  ".idea": true,
};

/** Guardrails: files scanned, bytes per file, tickets surfaced. */
export const TODO_MAX_FILES = 600;
export const TODO_MAX_FILE_BYTES = 200_000;
export const TODO_MAX_TICKETS = 30;

/** One matched TODO/FIXME line, before ticket mapping. */
export interface TodoMatch {
  file: string;
  line: number;
  marker: "TODO" | "FIXME";
  text: string;
}

function todoExt(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && (TODO_EXTS[name.slice(dot).toLowerCase()] ?? false);
}

/** Comment text after the marker, with comment syntax and separators stripped. */
export function todoCommentText(line: string, marker: string): string {
  const at = line.search(new RegExp(`\\b${marker}\\b`, "i"));
  const after = at >= 0 ? line.slice(at + marker.length) : line;
  return after
    .replace(/^[\s:(\[-]*/, "")
    .replace(/(\*\/|-->)\s*$/, "")
    .trim();
}

/** Collect candidate source files under root, honoring skip dirs and caps. */
function collectTodoFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < TODO_MAX_FILES) {
    const dir = stack.pop() as string;
    let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory) {
        // Skip hidden dirs (.git, .tmp, .plan, .omp, …); files at root level
        // like .giwt.toml are handled by the extension filter below.
        if (TODO_SKIP_DIRS[entry.name] ?? true) continue;
      }
      if (entry.isDirectory) {
        if (TODO_SKIP_DIRS[entry.name]) continue;
        stack.push(join(dir, entry.name));
      } else if (entry.isFile && todoExt(entry.name)) {
        out.push(join(dir, entry.name));
        if (out.length >= TODO_MAX_FILES) break;
      }
    }
  }
  return out;
}

/** Scan one file for TODO/FIXME lines; skips oversized/unreadable files. */
function scanTodoFile(abs: string): TodoMatch[] {
  let text: string;
  try {
    if (statSync(abs).size > TODO_MAX_FILE_BYTES) return [];
    text = readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  const matches: TodoMatch[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length > 500) continue; // minified/blob line
    const m = TODO_MARKER_RE.exec(line);
    if (!m?.[1]) continue;
    const marker = m[1].toUpperCase() === "FIXME" ? "FIXME" : "TODO";
    matches.push({ file: abs, line: i + 1, marker, text: todoCommentText(line, marker) });
  }
  return matches;
}

/**
 * Scan code comments for TODO/FIXME markers. FIXME → bug/P2, TODO → task/P3.
 * Hidden dirs, vendored deps, build output, and markdown docs are excluded.
 * Bounded (file count, file size, ticket cap) — best-effort, never throws.
 */
export function todoTickets(root: string): WorkTicket[] {
  let files: string[];
  try {
    files = collectTodoFiles(root);
  } catch {
    return [];
  }
  const matches: TodoMatch[] = [];
  for (const file of files) {
    try {
      matches.push(...scanTodoFile(file));
    } catch {
      continue;
    }
    if (matches.length >= TODO_MAX_TICKETS * 2) break;
  }
  matches.sort((a, b) => {
    if (a.marker !== b.marker) return a.marker === "FIXME" ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
  return matches.slice(0, TODO_MAX_TICKETS).map((m, i) => {
    const rel = relative(root, m.file);
    const head = rel.split("/")[0] ?? rel;
    return {
      id: `TD-${String(i + 1).padStart(2, "0")}`,
      title: `${m.marker}: ${m.text || "(no description)"} (${rel}:${m.line})`,
      source: "todo",
      kind: m.marker === "FIXME" ? ("bug" as const) : ("task" as const),
      priority: m.marker === "FIXME" ? "P2" : "P3",
      domain: head && head !== rel ? head : "root",
    };
  });
}

/**
 * Cheap applicability probe: does root contain any scannable source file?
 * Bounded two-level walk — keeps `todo` false for empty/doc-only dirs so
 * bare `/find-work` still shows usage there.
 */
export function hasTodoSource(root: string): boolean {
  try {
    const top = readdirSync(root, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isFile() && todoExt(entry.name)) return true;
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !(TODO_SKIP_DIRS[entry.name] ?? false)
      ) {
        try {
          const sub = readdirSync(join(root, entry.name), { withFileTypes: true });
          if (sub.some((e) => e.isFile() && todoExt(e.name))) return true;
        } catch {
          continue;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Branches/worktrees merge queue
// ---------------------------------------------------------------------------

/** Bounds: branches probed for ahead/behind, tickets surfaced. */
export const MERGE_MAX_BRANCHES = 12;
export const MERGE_MAX_TICKETS = 15;

/**
 * Run a tool CLI best-effort and return stdout. Linters, typecheckers, and
 * test runners exit nonzero precisely when they have findings, so a thrown
 * exec error still yields its stdout when the harness attaches it; only a
 * truly empty failure rethrows (caller turns it into a warning).
 */
async function execTool(
  pi: ExecLike,
  command: string,
  args: string[],
  timeout: number,
): Promise<string> {
  try {
    const res = await pi.exec(command, args, { timeout });
    return res.stdout ?? "";
  } catch (err) {
    const out = (err as { stdout?: unknown })?.stdout;
    if (typeof out === "string" && out.trim().length > 0) return out;
    throw err;
  }
}

export interface MergeBranch {
  name: string;
  sha: string;
  subject: string;
  date: string;
}

/**
 * Parse `git branch --format='%(refname:short)|%(objectname:short)|%(subject)|%(committerdate:short)'`.
 * Subjects may contain `|` — and branch names may too (legal, if perverse) —
 * so the short SHA (always hex) anchors the split: everything before the
 * first hex segment is the name, everything between it and the trailing
 * date is the subject.
 */
export function parseBranchLines(stdout: string): MergeBranch[] {
  const out: MergeBranch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const shaAt = parts.findIndex((p, i) => i > 0 && /^[0-9a-f]{4,40}$/.test(p.trim()));
    if (shaAt < 0) continue;
    const name = parts.slice(0, shaAt).join("|").trim();
    const sha = (parts[shaAt] ?? "").trim();
    const date = (parts[parts.length - 1] ?? "").trim();
    const subject = parts
      .slice(shaAt + 1, -1)
      .join("|")
      .trim();
    if (!name || !sha) continue;
    out.push({ name, sha, subject, date });
  }
  return out;
}

/** Parse `git rev-list --left-right --count <base>...<branch>` ("behind ahead"). */
export function parseRevCounts(stdout: string): { ahead: number; behind: number } | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(stdout.trim());
  if (!m?.[1] || !m?.[2]) return null;
  return { behind: Number(m[1]), ahead: Number(m[2]) };
}

/** Parse `git symbolic-ref refs/remotes/origin/HEAD` ("refs/remotes/origin/dev"). */
export function parseMergeBase(stdout: string): string | null {
  const m = /refs\/remotes\/[^/]+\/(.+?)\s*$/.exec(stdout.trim());
  const base = m?.[1]?.trim();
  return base ? base : null;
}

export interface MergeWorktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  /** Prune reason when git flags the entry stale; null when healthy. */
  prunable: string | null;
}

/** Parse `git worktree list --porcelain` blocks (blank-line separated). */
export function parseWorktreePorcelain(stdout: string): MergeWorktree[] {
  const out: MergeWorktree[] = [];
  let cur: MergeWorktree | null = null;
  const flush = () => {
    if (cur && cur.path) out.push(cur);
    cur = null;
  };
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      cur = {
        path: line.slice("worktree ".length).trim(),
        head: "",
        branch: null,
        bare: false,
        detached: false,
        prunable: null,
      };
    } else if (line.startsWith("HEAD ") && cur) {
      cur.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ") && cur) {
      const ref = line.slice("branch ".length).trim();
      cur.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line === "bare" && cur) {
      cur.bare = true;
    } else if (line === "detached" && cur) {
      cur.detached = true;
    } else if ((line === "prunable" || line.startsWith("prunable ")) && cur) {
      cur.prunable = line.slice("prunable".length).trim() || "stale metadata";
    }
  }
  flush();
  return out;
}

export interface DirtyStat {
  modified: number;
  untracked: number;
  total: number;
}

/** Parse `git status --short`: `??` counts untracked, anything else modified. */
export function parseStatusShort(stdout: string): DirtyStat {
  let modified = 0;
  let untracked = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 2) continue;
    if (line.startsWith("??")) untracked += 1;
    else modified += 1;
  }
  return { modified, untracked, total: modified + untracked };
}

/** Resolve the merge base: origin HEAD, then dev/main/master by existence. */
async function resolveMergeBase(pi: ExecLike, root: string): Promise<string> {
  try {
    const out = await execTool(
      pi,
      "git",
      ["-C", root, "symbolic-ref", "refs/remotes/origin/HEAD"],
      SOURCE_EXEC_TIMEOUT_MS,
    );
    const base = parseMergeBase(out);
    if (base) return base;
  } catch {
    /* fall through to local branch probes */
  }
  for (const candidate of ["dev", "main", "master"]) {
    try {
      const out = await execTool(
        pi,
        "git",
        ["-C", root, "branch", "--list", candidate],
        SOURCE_EXEC_TIMEOUT_MS,
      );
      if (out.split(/\r?\n/).some((l) => l.replace(/^[* ]+/, "").trim() === candidate)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  throw new Error("no merge base resolvable");
}

/** Unmerged-branch tickets: ahead/behind counts against the base. */
async function unmergedBranchTickets(
  pi: ExecLike,
  root: string,
  base: string,
): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    "git",
    [
      "-C",
      root,
      "branch",
      "--format=%(refname:short)|%(objectname:short)|%(subject)|%(committerdate:short)",
      "--no-merged",
      base,
    ],
    SOURCE_EXEC_TIMEOUT_MS,
  );
  const protectedBranches = new Set(resolveGiwtConfig(root).protectedBranches);
  const branches = parseBranchLines(out)
    .filter((b) => b.name !== base && !protectedBranches.has(b.name))
    .slice(0, MERGE_MAX_BRANCHES);
  const tickets: WorkTicket[] = [];
  for (const branch of branches) {
    let counts: { ahead: number; behind: number } | null = null;
    try {
      const raw = await execTool(
        pi,
        "git",
        ["-C", root, "rev-list", "--left-right", "--count", `${base}...${branch.name}`],
        SOURCE_EXEC_TIMEOUT_MS,
      );
      counts = parseRevCounts(raw);
    } catch {
      continue; // branch vanished mid-scan; skip it
    }
    if (!counts) continue;
    const stale = counts.behind > 0 ? `, ${counts.behind} behind` : "";
    tickets.push({
      id: branch.name,
      title: `merge ${branch.name} → ${base}: ${counts.ahead} ahead${stale}${branch.subject ? ` — ${branch.subject}` : ""}`,
      source: "merges",
      kind: "task",
      priority: "P2",
      domain: "branches",
    });
  }
  return tickets;
}

/** Dirty-worktree tickets: uncommitted changes per checkout. */
async function worktreeDirtyTickets(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    "git",
    ["-C", root, "worktree", "list", "--porcelain"],
    SOURCE_EXEC_TIMEOUT_MS,
  );
  const worktrees = parseWorktreePorcelain(out)
    .filter((w) => !w.bare)
    .slice(0, MERGE_MAX_BRANCHES);
  const tickets: WorkTicket[] = [];
  for (const wt of worktrees) {
    const name = wt.branch ?? wt.path.split("/").pop() ?? wt.path;
    const rel = wt.path.startsWith(`${root}/`) ? wt.path.slice(root.length + 1) : wt.path;
    if (wt.prunable) {
      tickets.push({
        id: `WT-${name}`,
        title: `prunable worktree ${rel} (${wt.prunable}) — git worktree prune to clean up`,
        source: "merges",
        kind: "task",
        priority: "P3",
        domain: "worktrees",
      });
      continue;
    }
    let stat: DirtyStat;
    try {
      const raw = await execTool(
        pi,
        "git",
        ["-C", wt.path, "status", "--short"],
        SOURCE_EXEC_TIMEOUT_MS,
      );
      stat = parseStatusShort(raw);
    } catch {
      continue; // worktree metadata broken; `git worktree repair` territory
    }
    if (stat.total === 0) continue;
    const bits = [
      stat.modified > 0 ? `${stat.modified} modified` : null,
      stat.untracked > 0 ? `${stat.untracked} untracked` : null,
    ]
      .filter(Boolean)
      .join(", ");
    tickets.push({
      id: `WT-${name}`,
      title: `uncommitted changes in ${rel} (${bits})${wt.branch ? ` — ${wt.branch}` : ""}`,
      source: "merges",
      kind: "task",
      priority: "P1",
      domain: "worktrees",
    });
  }
  return tickets;
}

/**
 * Merge-queue tickets: unmerged branches (ahead/behind vs base), worktrees
 * holding uncommitted changes, and prunable (stale) worktree entries.
 * Throws when git is unusable — the caller turns that into a warning.
 */
export async function fetchMergeTickets(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const base = await resolveMergeBase(pi, root);
  const branches = await unmergedBranchTickets(pi, root, base);
  const worktrees = await worktreeDirtyTickets(pi, root);
  return [...worktrees, ...branches].slice(0, MERGE_MAX_TICKETS);
}

// ---------------------------------------------------------------------------
// Tool cluster: lint / typecheck / tests / knip / jscpd
// ---------------------------------------------------------------------------

/** Per-run timeouts (ms) for repo-health tools. */
export const LINT_TIMEOUT_MS = 45_000;
export const TYPECHECK_TIMEOUT_MS = 60_000;
export const TESTS_TIMEOUT_MS = 120_000;
export const KNIP_TIMEOUT_MS = 60_000;
export const JSCPD_TIMEOUT_MS = 90_000;

/** Max tickets surfaced per tool-cluster source. */
export const TOOL_MAX_TICKETS = 15;

/** Prefer the repo-pinned binary; fall back to PATH. */
function toolBin(root: string, name: string): string {
  const local = join(root, "node_modules", ".bin", name);
  try {
    if (existsSync(local)) return local;
  } catch {
    /* fall through to PATH */
  }
  return name;
}

/** `01`, `02`, … ticket sequence suffix. */
function pad2(i: number): string {
  return String(i + 1).padStart(2, "0");
}

/** Repo-relative display path when under root; raw otherwise. */
function relToRoot(root: string, file: string): string {
  const f = file.trim();
  if (f.startsWith(`${root}/`)) return f.slice(root.length + 1);
  return f;
}

// ---- eslint ----

export interface EslintFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  error: boolean;
}

/**
 * Parse `eslint --format json` ([{filePath, messages[]}]). Empty output
 * (clean lint) yields []; non-empty unparseable output throws.
 */
export function parseEslintJson(stdout: string, root: string): EslintFinding[] {
  if (!stdout.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("eslint: unparseable JSON output");
  }
  if (!Array.isArray(data)) throw new Error("eslint: unexpected JSON shape");
  const out: EslintFinding[] = [];
  for (const file of data) {
    const f = file as { filePath?: unknown; messages?: unknown };
    if (typeof f.filePath !== "string" || !Array.isArray(f.messages)) continue;
    for (const raw of f.messages) {
      const m = raw as { ruleId?: unknown; severity?: unknown; message?: unknown; line?: unknown };
      out.push({
        file: relToRoot(root, f.filePath),
        line: typeof m.line === "number" ? m.line : 0,
        rule: typeof m.ruleId === "string" && m.ruleId ? m.ruleId : "eslint",
        message: typeof m.message === "string" ? m.message : "",
        error: m.severity === 2,
      });
    }
  }
  return out;
}

// ---- biome ----

/** Biome rule groups treated as bugs (likely broken, not just style). */
const BIOME_BUG_PREFIXES = ["lint/correctness/", "lint/suspicious/", "parse/"];

export interface BiomeFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  error: boolean;
}

/** `path:line:col rule ━━━` header lines in `biome check` output. */
const BIOME_HEADER_RE = /^(\S+):(\d+):(\d+)\s+([\w@/.~$-]+)/;
/** Diagnostic message lines (`!`, `×`, `?`, `i` markers). */
const BIOME_MESSAGE_RE = /^\s*[!×?i]\s+(.+?)\s*$/;

/**
 * Parse `biome check` human output. Correctness/suspicious/parse rules map
 * to bugs (they flag likely-broken code); style/complexity/a11y map to tasks.
 */
export function parseBiomeOutput(stdout: string, root: string): BiomeFinding[] {
  const lines = stdout.split(/\r?\n/);
  const out: BiomeFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = BIOME_HEADER_RE.exec(lines[i] ?? "");
    if (!h?.[1] || !h[2] || !h[4]) continue;
    let message = h[4];
    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      const msg = BIOME_MESSAGE_RE.exec(lines[j] ?? "");
      if (msg?.[1]) {
        message = msg[1];
        break;
      }
      if (BIOME_HEADER_RE.test(lines[j] ?? "")) break;
    }
    const rule = h[4];
    out.push({
      file: relToRoot(root, h[1]),
      line: Number(h[2]),
      rule,
      message,
      error: BIOME_BUG_PREFIXES.some((p) => rule.startsWith(p)),
    });
  }
  return out;
}

// ---- oxlint ----

export interface OxlintFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  error: boolean;
}

/**
 * Parse `oxlint --format json` (`{diagnostics: [...]}` — verified shape).
 * Empty output yields []; non-empty unparseable output throws.
 */
export function parseOxlintJson(stdout: string, root: string): OxlintFinding[] {
  if (!stdout.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("oxlint: unparseable JSON output");
  }
  const diags = (data as { diagnostics?: unknown })?.diagnostics;
  if (!Array.isArray(diags)) throw new Error("oxlint: unexpected JSON shape");
  const out: OxlintFinding[] = [];
  for (const raw of diags) {
    const d = raw as {
      message?: unknown;
      code?: unknown;
      severity?: unknown;
      filename?: unknown;
      labels?: unknown;
    };
    const spans = Array.isArray(d.labels) ? d.labels : [];
    const first = spans[0] as { span?: { line?: unknown } } | undefined;
    const line = first?.span && typeof first.span.line === "number" ? first.span.line : 0;
    out.push({
      file: typeof d.filename === "string" ? relToRoot(root, d.filename) : "",
      line,
      rule: typeof d.code === "string" && d.code ? d.code : "oxlint",
      message: typeof d.message === "string" ? d.message : "",
      error: d.severity === "error",
    });
  }
  return out;
}

// ---- tsc ----

export interface TscError {
  file: string;
  line: number;
  code: string;
  message: string;
}

/** `path(line,col): error TS####: message` lines in `tsc --noEmit` output. */
const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.+?)\s*$/;

/** Parse `tsc --noEmit` output; non-matching lines (summaries) are skipped. */
export function parseTscOutput(stdout: string, root: string): TscError[] {
  const out: TscError[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = TSC_LINE_RE.exec(line);
    if (!m?.[1] || !m[2] || !m[4] || !m[5]) continue;
    out.push({ file: relToRoot(root, m[1]), line: Number(m[2]), code: m[4], message: m[5] });
  }
  return out;
}

// ---- tests ----

export interface TestFailure {
  name: string;
}

/**
 * Parse test-runner failure lines: bun `(fail)`, jest/vitest `FAIL`,
 * pytest `FAILED`, go `--- FAIL:`. Falls back to a single summary ticket
 * when a nonzero failure count is stated but no lines parse.
 */
export function parseTestOutput(stdout: string): TestFailure[] {
  const out: TestFailure[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    let m = /^\(fail\)\s+(.+?)(?:\s+\[\d[^\]]*\])?\s*$/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1].trim() });
      continue;
    }
    m = /^FAIL\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1].trim() });
      continue;
    }
    m = /^FAILED\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1].trim() });
      continue;
    }
    m = /^--- FAIL:\s+(\S+)/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1] });
    }
  }
  if (out.length === 0) {
    const sum = /(\d+)\s+(?:tests?\s+)?fail(?:ed|ing|ures)?\b/i.exec(stdout);
    if (sum?.[1] && Number(sum[1]) > 0) {
      out.push({ name: `${sum[1]} failing (see test output)` });
    }
  }
  return out;
}

// ---- knip ----

export interface KnipFinding {
  kind: "file" | "export" | "dependency" | "issue";
  file: string;
  name: string;
  line?: number;
}

const KNIP_KIND_KEYS = [
  "files",
  "exports",
  "dependencies",
  "devDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "types",
  "duplicates",
] as const;

function knipItemName(item: unknown): { name: string; line?: number } {
  if (typeof item === "string") return { name: item };
  const o = item as { name?: unknown; symbol?: unknown; specifier?: unknown; line?: unknown };
  const name =
    typeof o.name === "string" && o.name
      ? o.name
      : typeof o.symbol === "string" && o.symbol
        ? o.symbol
        : typeof o.specifier === "string" && o.specifier
          ? o.specifier
          : JSON.stringify(item).slice(0, 80);
  const line = typeof o.line === "number" ? o.line : undefined;
  return { name, line };
}

/** Singular display kind for a knip issue key. */
function knipKind(key: string): KnipFinding["kind"] {
  if (key === "files") return "file";
  if (key === "exports") return "export";
  if (key === "dependencies" || key === "devDependencies" || key === "unlisted") {
    return "dependency";
  }
  return "issue";
}

/**
 * Parse `knip --reporter json`. Handles the `{issues: [...]}` shape
 * (verified) plus the legacy keyed shape, tolerating string/object items.
 */
export function parseKnipIssues(data: unknown): KnipFinding[] {
  const out: KnipFinding[] = [];
  const pushItems = (key: string, items: unknown, file: string) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const { name, line } = knipItemName(item);
      if (!name) continue;
      out.push({ kind: knipKind(key), file, name, line });
    }
  };
  const root = data as { issues?: unknown };
  if (Array.isArray(root?.issues)) {
    for (const raw of root.issues) {
      const issue = raw as { file?: unknown } & Record<string, unknown>;
      const file = typeof issue.file === "string" ? issue.file : "";
      for (const key of KNIP_KIND_KEYS) pushItems(key, issue[key], file);
    }
    return out;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of KNIP_KIND_KEYS) pushItems(key, obj[key], "");
  }
  return out;
}

// ---- jscpd ----

export interface CloneFinding {
  a: string;
  lineA: number;
  b: string;
  lineB: number;
  lines: number;
}

/** jscpd languages passed via `-f` (verified to exist; unknown names fail the run). */
const JSCPD_FORMATS = "typescript,javascript,python,java,ruby,php";

/**
 * Parse a jscpd JSON report (`{duplicates: [...]}` — verified shape).
 * Empty duplicates yields []; missing shape throws.
 */
export function parseJscpdReport(data: unknown): CloneFinding[] {
  const dups = (data as { duplicates?: unknown })?.duplicates;
  if (!Array.isArray(dups)) throw new Error("jscpd: unexpected report shape");
  const out: CloneFinding[] = [];
  for (const raw of dups) {
    const d = raw as {
      firstFile?: { name?: unknown; startLoc?: { line?: unknown } };
      secondFile?: { name?: unknown; startLoc?: { line?: unknown } };
      lines?: unknown;
    };
    const a = typeof d.firstFile?.name === "string" ? d.firstFile.name : "";
    const b = typeof d.secondFile?.name === "string" ? d.secondFile.name : "";
    const lineA = typeof d.firstFile?.startLoc?.line === "number" ? d.firstFile.startLoc.line : 0;
    const lineB = typeof d.secondFile?.startLoc?.line === "number" ? d.secondFile.startLoc.line : 0;
    const lines = typeof d.lines === "number" ? d.lines : 0;
    if (!a || !b) continue;
    out.push({ a, lineA, b, lineB, lines });
  }
  return out;
}

// ---- runners ----

/** Map generic lint findings (eslint/biome/oxlint shape) to tickets. */
function lintFindingTickets(
  findings: Array<{ file: string; line: number; rule: string; message: string; error: boolean }>,
  prefix: string,
): WorkTicket[] {
  return findings.slice(0, TOOL_MAX_TICKETS).map((f, i) => ({
    id: `${prefix}-${pad2(i)}`,
    title: `[${f.rule}] ${f.message} (${f.file}:${f.line})`,
    source: "lint",
    kind: f.error ? ("bug" as const) : ("task" as const),
    priority: f.error ? "P2" : "P3",
    domain: "lint",
  }));
}

/** Run the configured linter (eslint > biome > oxlint) and map findings. */
async function runLintCluster(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const tool = detectLintTool(root);
  if (!tool) return [];
  if (tool === "eslint") {
    const out = await execTool(
      pi,
      toolBin(root, "eslint"),
      ["--format", "json", root],
      LINT_TIMEOUT_MS,
    );
    if (!out.trim()) return [];
    return lintFindingTickets(parseEslintJson(out, root), "LT");
  }
  if (tool === "oxlint") {
    const out = await execTool(
      pi,
      toolBin(root, "oxlint"),
      ["--format", "json", root],
      LINT_TIMEOUT_MS,
    );
    if (!out.trim()) return [];
    return lintFindingTickets(parseOxlintJson(out, root), "LT");
  }
  const out = await execTool(
    pi,
    toolBin(root, "biome"),
    ["check", "--max-diagnostics=30", root],
    LINT_TIMEOUT_MS,
  );
  if (!out.trim()) return [];
  return lintFindingTickets(parseBiomeOutput(out, root), "LT");
}

/** Run `tsc --noEmit` and map errors to P1 bug tickets. */
async function runTypecheck(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    toolBin(root, "tsc"),
    ["--noEmit", "-p", root],
    TYPECHECK_TIMEOUT_MS,
  );
  if (!out.trim()) return [];
  return parseTscOutput(out, root)
    .slice(0, TOOL_MAX_TICKETS)
    .map((e, i) => ({
      id: `TS-${pad2(i)}`,
      title: `${e.code}: ${e.message} (${e.file}:${e.line})`,
      source: "typecheck",
      kind: "bug" as const,
      priority: "P1",
      domain: "typecheck",
    }));
}

/** Run the repo `test` script (bun preferred, npm fallback) and map failures. */
async function runTests(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  // NOTE: pi.exec has no cwd option — like the gh/git-issue calls below,
  // this assumes the process cwd is the session repo (see completions.ts).
  void root;
  const bin = onPath("bun") ? "bun" : "npm";
  const args = bin === "bun" ? ["run", "test"] : ["test", "--silent"];
  const out = await execTool(pi, bin, args, TESTS_TIMEOUT_MS);
  if (!out.trim()) return [];
  return parseTestOutput(out)
    .slice(0, TOOL_MAX_TICKETS)
    .map((f, i) => ({
      id: `TT-${pad2(i)}`,
      title: `FAIL ${f.name}`,
      source: "tests",
      kind: "bug" as const,
      priority: "P1",
      domain: "tests",
    }));
}

/** Run knip (JSON reporter, alternate cwd) and map unused-code findings. */
async function runKnip(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    toolBin(root, "knip"),
    [
      "--reporter",
      "json",
      "-n",
      "-D",
      root,
      "--include",
      "files,exports,dependencies,devDependencies",
    ],
    KNIP_TIMEOUT_MS,
  );
  if (!out.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    throw new Error("knip: unparseable JSON output");
  }
  return parseKnipIssues(data)
    .slice(0, TOOL_MAX_TICKETS)
    .map((f, i) => ({
      id: `KN-${pad2(i)}`,
      title: `knip ${f.kind}: ${f.name}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`,
      source: "knip",
      kind: f.kind === "issue" ? ("bug" as const) : ("task" as const),
      priority: f.kind === "issue" ? "P2" : "P3",
      domain: "knip",
    }));
}

/** Run jscpd (JSON report to a temp dir) and map duplications. */
async function runJscpd(pi: ExecLike, root: string): Promise<WorkTicket[]> {
  const outDir = mkdtempSync(join(tmpdir(), "find-work-jscpd-"));
  try {
    const cfg = join(root, ".jscpd.json");
    const args = [
      "--silent",
      "-r",
      "json",
      "-o",
      outDir,
      "-f",
      JSCPD_FORMATS,
      "--exit-code",
      "0",
      ...(existsSync(cfg) ? ["-c", cfg] : []),
      root,
    ];
    await execTool(pi, toolBin(root, "jscpd"), args, JSCPD_TIMEOUT_MS);
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(outDir, "jscpd-report.json"), "utf8"));
    } catch {
      throw new Error("jscpd: report unreadable");
    }
    return parseJscpdReport(data)
      .slice(0, TOOL_MAX_TICKETS)
      .map((c, i) => ({
        id: `CPD-${pad2(i)}`,
        title: `${c.lines} duplicated lines: ${c.a}:${c.lineA} ↔ ${c.b}:${c.lineB}`,
        source: "jscpd",
        kind: "task" as const,
        priority: "P3",
        domain: "duplication",
      }));
  } finally {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* scratch cleanup is best-effort */
    }
  }
}

interface ToolFetch {
  tickets: WorkTicket[];
  warnings: string[];
}

/** Run one tool-cluster source, converting any failure into a warning. */
async function runGuarded(
  label: string,
  hint: string,
  run: () => Promise<WorkTicket[]>,
): Promise<{ tickets: WorkTicket[]; warning?: string }> {
  try {
    return { tickets: await run() };
  } catch {
    return { tickets: [], warning: `${label} scan failed (${hint})` };
  }
}

/**
 * Run the detected tool-cluster sources concurrently (independent
 * subprocesses) and collect tickets + warnings.
 */
export async function fetchToolTickets(
  pi: ExecLike,
  root: string,
  sources: WorkSources,
): Promise<ToolFetch> {
  const jobs: Array<Promise<{ tickets: WorkTicket[]; warning?: string }>> = [];
  if (sources.lint) {
    jobs.push(
      runGuarded("lint", "linter not installed or timed out?", () => runLintCluster(pi, root)),
    );
  }
  if (sources.typecheck) {
    jobs.push(
      runGuarded("typecheck", "tsc not installed or timed out?", () => runTypecheck(pi, root)),
    );
  }
  if (sources.tests) {
    jobs.push(
      runGuarded("tests", "timed out? run the test command directly", () => runTests(pi, root)),
    );
  }
  if (sources.knip) {
    jobs.push(runGuarded("knip", "knip not installed or timed out?", () => runKnip(pi, root)));
  }
  if (sources.jscpd) {
    jobs.push(runGuarded("jscpd", "jscpd not installed or timed out?", () => runJscpd(pi, root)));
  }
  const tickets: WorkTicket[] = [];
  const warnings: string[] = [];
  for (const result of await Promise.all(jobs)) {
    tickets.push(...result.tickets);
    if (result.warning) warnings.push(result.warning);
  }
  return { tickets, warnings };
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
 * become warnings; the rest of the sources still contribute. Uncapped —
 * the caller filters and caps (see presentFindWork).
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
    warnings.push("receipt ledger unreadable (receipt.toml malformed?)");
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
  if (sources.giwtLedger) {
    try {
      const giwtTickets = giwtLedgerTickets(root);
      if (giwtTickets.length > 0) tickets.push(...giwtTickets);
      else warnings.push("giwt ledger empty (.ledger.jsonl has no records)");
    } catch {
      warnings.push("giwt ledger unreadable (.ledger.jsonl malformed?)");
    }
  }
  if (sources.giwtRuns) {
    try {
      const runTickets = giwtRunTickets(root);
      if (runTickets.length > 0) tickets.push(...runTickets);
    } catch {
      warnings.push("giwt run records scan failed");
    }
  }
  if (sources.todo) {
    try {
      const found = todoTickets(root);
      if (found.length > 0) tickets.push(...found);
    } catch {
      warnings.push("TODO comment scan failed");
    }
  }
  if (sources.merges) {
    try {
      tickets.push(...(await fetchMergeTickets(pi, root)));
    } catch {
      warnings.push("git branch/worktree scan failed (not a git repo?)");
    }
  }
  if (sources.lint || sources.typecheck || sources.tests || sources.knip || sources.jscpd) {
    const tools = await fetchToolTickets(pi, root, sources);
    tickets.push(...tools.tickets);
    warnings.push(...tools.warnings);
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
  let filtered = filterTickets(tickets, parsed);
  if (parsed.mode === "ask" && parsed.query && filtered.length === 0) {
    // The directive has no lexical overlap with the roster (e.g. prose like
    // "propose fixes"): keep the dialog, but say so instead of silently
    // presenting unrelated priority-order tickets as topic candidates.
    ctx.ui.notify(`no open items match '${parsed.query}' — showing unfiltered`, "info");
    filtered = filterTickets(tickets, { ...parsed, query: "" });
  }
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
  if (filtered.length > MAX_TICKETS) {
    ctx.ui.notify(`showing first ${MAX_TICKETS} of ${filtered.length} matching items`, "warning");
    filtered = filtered.slice(0, MAX_TICKETS);
  }
  const labeled = labelTickets(filtered, parsed.scheme);
  if (parsed.mode === "ask") {
    await runAsk(pi, ctx, root, sources, labeled, parsed);
    return;
  }
  if (parsed.mode === "orchestrate") {
    await pi.sendUserMessage(buildOrchestratePrompt(labeled, sources, parsed.query));
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

/** The exact `list-*` sugar variants the parser accepts (usage-hint order). */
export const FIND_WORK_SUGAR = [
  "list-order",
  "list-letters",
  "list-priorities",
  "list-types",
  "list-batches",
  "list-bugs",
  "list-features",
  "list-epics",
  "list-tasks",
] as const;

/** Canonical option-region vocabulary (first token also allows mode words). */
const OPTION_KEYWORDS = [
  ...MODE_KEYWORDS,
  "order",
  "letters",
  "priorities",
  "types",
  "batches",
  "bugs",
  "features",
  "epics",
  "tasks",
];

/**
 * Tab completion for `/find-work …`. The option region is enumerable —
 * mode/scheme/grouping/kind keywords plus `list-*` sugar — while the
 * directive is free text. Once the completed tokens form a directive
 * (parse moved into the query region), completion stops.
 */
export function findWorkCompletions(argPrefix: string): string[] {
  const endsWithSpace = /\s$/.test(argPrefix);
  const all = argPrefix.trim().split(/\s+/).filter(Boolean);
  const partial =
    endsWithSpace || all.length === 0 ? "" : (all[all.length - 1] ?? "").toLowerCase();
  const complete = endsWithSpace ? all : all.slice(0, -1);
  const { args, error } = parseFindWorkArgs(complete);
  if (error || args.query) return [];
  const vocab =
    partial === "list" || partial.startsWith("list-")
      ? [...FIND_WORK_SUGAR]
      : complete.length === 0
        ? OPTION_KEYWORDS
        : OPTION_KEYWORDS.filter((word) => !(MODE_KEYWORDS as readonly string[]).includes(word));
  return vocab.filter((word) => word.startsWith(partial));
}

/** Register `/find-work` on the plugin factory's `pi`. */
export function registerFindWork(pi: ExtensionAPI): void {
  pi.registerCommand("find-work", {
    description:
      "Find actionable tickets across trackers: " +
      "/find-work [list|table|ask|orchestrate] [order|letters|priorities|types] [batches] [bugs|features|epics|tasks] [directive...]",
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(argumentPrefix, findWorkCompletions(argumentPrefix)),
    handler: async (args, ctx) => {
      await runFindWork(pi, ctx as AskCapableContext, args.trim().split(/\s+/).filter(Boolean));
    },
  });
}
