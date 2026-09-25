/**
 * `/find-work` roster sources backed by external CLI tools and giwt
 * bookkeeping: `gh issue list`, `git-issue ls`, giwt ledger, giwt runs.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readGiwtLedger } from "../../receipt/giwt-bridge";
import { resolveGiwtConfig } from "../../util/giwt-config";
import { classifyKind, classifyPriority, domainOf } from "./classify";
import { DEFAULT_PRIORITY } from "./keywords";
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
 */
const GIT_ISSUE_LINE_RE =
  /^\s*(?:#?(?<hex>[0-9a-f]{3,})[.)]?\s+|(?<num>\d+)[.)]?\s+)(?<rest>\S.*)$/i;
const GIT_ISSUE_STATE_RE = /\s*\[[^\]]+\]\s+/;

export function parseGitIssueList(stdout: string): WorkTicket[] {
  const tickets: WorkTicket[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    // Capture the bracketed state (e.g. "[open]") before stripping, so closed
    // issues don't surface as work items. `git-issue ls` defaults to
    // `--state open`, but the consumer still filters: explicit `--state all`
    // invocations and older shims may emit every issue.
    const stateMatch = /^\s*\S+\s+\[(?<state>[^\]]+)\]\s+/.exec(rawLine);
    if (stateMatch?.groups?.state?.toLowerCase() === "closed") continue;
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
