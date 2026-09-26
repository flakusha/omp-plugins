/**
 * `/find-work` roster sources backed by external CLI tools and giwt
 * bookkeeping: `gh issue list`, `git-issue ls`, giwt ledger, giwt runs.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readGiwtLedger } from "../../receipt/giwt-bridge";
import { resolveGiwtConfig } from "../../util/giwt-config";
import { classifyKind, classifyPriority, domainOf } from "./classify";
import { ARTIFACT_STALE_DAYS, DEFAULT_PRIORITY, VERIFIED_AT_RE } from "./keywords";
import type { WorkTicket } from "./types";

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
      tags: labels,
      url: issue.url,
    };
  });
}

/**
 * git-issue / `git issue ls` lines are `<hex-or-num>[ ][state] <TYPE-id>: <title>`.
 * Plain `N. title` and `N title` shapes are also accepted (legacy fallback).
 * The shared `NUMBERED_LINE_RE` only handles decimal numerics, so this parser
 * uses a local regex that captures hex or decimal ids and strips a leading
 * bracketed state token (e.g. `[open]`) before capture — otherwise the
 * canonical title starts with `[open] BUG-…` and `classifyKind` cannot
 * recognise the `BUG-` / `FEAT-` / `TASK-` prefix. Without this, every kind
 * falls back to `task` and `kinds=[bug]` filters empty.
 *
 * State filtering lives in the invocation (`git-issue ls --state=open`),
 * not here: the parser only strips the state token. A `[closed]` line
 * reaching this parser means the caller explicitly asked for closed
 * issues (e.g. an `--state all` sweep).
 */
const GIT_ISSUE_LINE_RE =
  /^\s*(?:#?(?<hex>[0-9a-f]{3,})[.)]?\s+|(?<num>\d+)[.)]?\s+)(?<rest>\S.*)$/i;
const GIT_ISSUE_STATE_RE = /\s*\[[^\]]+\]\s+/;

export function parseGitIssueList(stdout: string): WorkTicket[] {
  const tickets: WorkTicket[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    // The parser only strips the bracketed state token so classification
    // sees the bare title; state filtering happens at the invocation
    // (`ls --state=open`). Closed lines here mean the caller asked for them.
    const line = rawLine.replace(GIT_ISSUE_STATE_RE, " ");
    const m = GIT_ISSUE_LINE_RE.exec(line);
    if (!m?.groups) continue;
    const title = (m.groups.rest ?? "").trim();
    if (!title) continue;
    const id = m.groups.hex || m.groups.num || title;
    tickets.push({
      id: `GI-${id}`,
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
 * carrying `::` (say-annotated) are richer work signals; bare mutating
 * commands surface recent agent activity. Two records are never work:
 * ✅-resolved commit outcomes (the work is done) and bare observation
 * commands (show/state/comment/… — reading state creates none). Bare
 * observation records previously flooded the roster: a single giwt
 * checkout surfaced 30 such records as P3 candidates.
 */
const LEDGER_OBSERVATION_CMDS: Record<string, true> = {
  show: true,
  state: true,
  comment: true,
  issues: true,
  list: true,
  log: true,
  diff: true,
  runs: true,
  branches: true,
  doctor: true,
  label: true,
};

/** Collect giwt ledger entries as work tickets (filters above apply). */
export function giwtLedgerTickets(root: string): WorkTicket[] {
  const giwtConfig = resolveGiwtConfig(root);
  if (!giwtConfig.available) return [];
  const entries = readGiwtLedger(giwtConfig.treeDir);
  const tickets: WorkTicket[] = [];
  for (const entry of entries) {
    if (entry.summary.includes("✅")) continue; // commit outcome — resolved work
    const hasSay = entry.summary.includes("::");
    if (!hasSay && LEDGER_OBSERVATION_CMDS[entry.cmd.trim().toLowerCase()]) continue;
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
 * Effective timestamp (ms) of a run record: a `verified-at: <ISO>` line in
 * meta.json wins, else the run dir's mtime. Null when neither is readable
 * (the caller drops the record).
 */
function runEffectiveMs(runDir: string, metaText: string): number | null {
  const verifiedLine = metaText.split(/\r?\n/).find((line) => VERIFIED_AT_RE.test(line));
  const verifiedMs = Date.parse(VERIFIED_AT_RE.exec(verifiedLine ?? "")?.[1] ?? "");
  if (!Number.isNaN(verifiedMs)) return verifiedMs;
  try {
    return statSync(runDir).mtimeMs;
  } catch {
    return null;
  }
}

/** True when the record falls to the dd159ba AC5 staleness gate. */
function isStaleRun(runDir: string, metaText: string): boolean {
  const effectiveMs = runEffectiveMs(runDir, metaText);
  return effectiveMs === null || Date.now() - effectiveMs > ARTIFACT_STALE_DAYS * 86_400_000;
}

/** A giwt run record's meta.json payload: parsed fields + raw text (marker scan). */
interface RunMeta {
  cmd?: string;
  args?: string[];
  branch?: string;
  end?: string;
  exitCode?: number;
}

/** Read one run record's meta.json; null when absent, unreadable, or unparseable. */
function readRunMeta(metaPath: string): { meta: RunMeta; metaText: string } | null {
  if (!existsSync(metaPath)) return null;
  let metaText: string;
  try {
    metaText = readFileSync(metaPath, "utf8");
  } catch {
    return null;
  }
  try {
    return { meta: JSON.parse(metaText), metaText };
  } catch {
    return null;
  }
}

/** True iff the record terminated abnormally (no end/exitCode in meta.json). */
function isAbnormalRun(meta: RunMeta): boolean {
  return !(meta.end && meta.exitCode !== undefined);
}

/**
 * giwt run records with abnormal termination (missing end/exitCode in
 * meta.json) become high-priority bug candidates. Each run dir under
 * `.tmp/giwt/runs/` has a `meta.json` — a record without `end` means
 * the process was killed or exited abnormally. Records older than
 * ARTIFACT_STALE_DAYS are suppressed (dd159ba AC5).
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
    const runDir = join(runsDir, dir);
    const record = readRunMeta(join(runDir, "meta.json"));
    if (!record) continue;
    if (!isAbnormalRun(record.meta)) continue; // only abnormal terminations are work
    if (isStaleRun(runDir, record.metaText)) continue;
    const cmd = record.meta.cmd ?? "unknown";
    const argStr = (record.meta.args ?? []).join(" ");
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
