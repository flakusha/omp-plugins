/**
 * `/find-work` roster ticket sources: receipt ledger, plan docs, gh, git-issue, giwt records.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readGiwtLedger } from "../../receipt/giwt-bridge";
import type { ReceiptDoc } from "../../receipt/receipt";
import { DEFAULT_STATE, parseReceipt } from "../../receipt/receipt";
import { resolveGiwtConfig, resolvePlanDir } from "../../util/giwt-config";
import { readPlanLabels } from "../../util/plan-frontmatter";
import { classifyKind, classifyPriority, domainOf, kindFromReceiptId } from "./classify";
import {
  DEFAULT_PRIORITY,
  HEADING_RE,
  KEY_VALUE_RE,
  NUMBERED_LINE_RE,
  STATUS_DONE_RE,
  STATUS_LINE_RE,
} from "./keywords";
import type { TicketKind, WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// Receipt / plan / gh / git-issue / giwt ticket sources
// ---------------------------------------------------------------------------

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
