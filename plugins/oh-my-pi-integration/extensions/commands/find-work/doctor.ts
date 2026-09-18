/**
 * `/find-work` giwt doctor bridge: delegate the whole tool cluster to one
 * `giwt doctor check --json` call and map its report back to tickets with
 * the same priorities as the direct runners.
 */

import { giwtOnPath } from "../../util/giwt-config";
import { TOOL_MAX_TICKETS } from "./keywords";
import { type ExecLike, execTool, pad2, relToRoot } from "./tool-exec";
import type { ToolFetch, WorkTicket } from "./types";

/** Timeout for one `giwt doctor check` call (runs tools sequentially). */
export const DOCTOR_TIMEOUT_MS = 300_000;

/** Tool-cluster checks, in stable delegation order. */
export const DOCTOR_CHECKS = ["lint", "typecheck", "tests", "knip", "jscpd"] as const;
export type DoctorCheck = (typeof DOCTOR_CHECKS)[number];

/** Narrow an unknown check id to the delegation vocabulary. */
function isDoctorCheck(id: string): id is DoctorCheck {
  return (DOCTOR_CHECKS as readonly string[]).includes(id);
}

interface DoctorFinding {
  file?: unknown;
  line?: unknown;
  rule?: unknown;
  message?: unknown;
  severity?: unknown;
  kind?: unknown;
}

interface DoctorCheckResult {
  id?: unknown;
  tool?: unknown;
  ok?: unknown;
  skipped?: unknown;
  error?: unknown;
  findings?: unknown;
}

interface DoctorReport {
  version?: unknown;
  checks?: unknown;
}

/** Parse `giwt doctor check --json` output; throws on any shape mismatch. */
export function parseDoctorReport(stdout: string): DoctorCheckResult[] {
  // giwt's dispatcher may print run-record chatter before the JSON —
  // parse from the first object brace.
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("giwt doctor: unparseable JSON output");
  let data: unknown;
  try {
    data = JSON.parse(stdout.slice(start));
  } catch {
    throw new Error("giwt doctor: unparseable JSON output");
  }
  const report = data as DoctorReport;
  if (report?.version !== 1 || !Array.isArray(report.checks)) {
    throw new Error("giwt doctor: unexpected report shape");
  }
  return report.checks as DoctorCheckResult[];
}

function doctorFindingText(f: DoctorFinding): string {
  return typeof f.message === "string" ? f.message : "";
}

function doctorFindingRule(f: DoctorFinding, fallback: string): string {
  return typeof f.rule === "string" && f.rule ? f.rule : fallback;
}

function doctorFindingLine(f: DoctorFinding): number {
  return typeof f.line === "number" ? f.line : 0;
}

function doctorFindingFile(f: DoctorFinding, root: string): string {
  return typeof f.file === "string" && f.file ? relToRoot(root, f.file) : "";
}

/**
 * Map one doctor check's findings to tickets, reproducing the direct-runner
 * priorities: typecheck/tests errors are P1, other errors P2, warnings P3.
 */
function mapDoctorCheck(
  check: DoctorCheckResult,
  root: string,
  seq: { n: number },
): { tickets: WorkTicket[]; warnings: string[] } {
  const tickets: WorkTicket[] = [];
  const warnings: string[] = [];
  const id = typeof check.id === "string" ? check.id : "";
  if (check.error !== undefined && check.error !== null && check.error !== "") {
    warnings.push(`${id || "doctor"}: ${String(check.error)}`);
  }
  if (!Array.isArray(check.findings)) return { tickets, warnings };
  const prefix =
    id === "lint"
      ? "LT"
      : id === "typecheck"
        ? "TS"
        : id === "tests"
          ? "TT"
          : id === "knip"
            ? "KN"
            : id === "jscpd"
              ? "CPD"
              : "DR";
  const domain =
    id === "lint"
      ? "lint"
      : id === "typecheck"
        ? "typecheck"
        : id === "tests"
          ? "tests"
          : id === "knip"
            ? "knip"
            : id === "jscpd"
              ? "duplication"
              : "doctor";
  for (const raw of check.findings.slice(0, TOOL_MAX_TICKETS)) {
    const f = raw as DoctorFinding;
    const error = f.severity === "error";
    const file = doctorFindingFile(f, root);
    const line = doctorFindingLine(f);
    const title =
      id === "lint"
        ? `[${doctorFindingRule(f, "lint")}] ${doctorFindingText(f)} (${file}:${line})`
        : id === "typecheck"
          ? `${doctorFindingRule(f, "TS")}: ${doctorFindingText(f)} (${file}:${line})`
          : id === "tests"
            ? `FAIL ${doctorFindingText(f)}`
            : id === "knip"
              ? `knip ${doctorFindingRule(f, "issue")}: ${doctorFindingText(f)}${file ? ` (${file}${line ? `:${line}` : ""})` : ""}`
              : `${doctorFindingText(f)}${file ? ` (${file}${line ? `:${line}` : ""})` : ""}`;
    tickets.push({
      id: `${prefix}-${pad2(seq.n++)}`,
      title,
      source: id || "doctor",
      kind: error ? "bug" : "task",
      priority: id === "typecheck" || id === "tests" ? "P1" : error ? "P2" : "P3",
      domain,
    });
  }
  return { tickets, warnings };
}

/**
 * Map a parsed doctor report to tickets, keeping only the requested checks.
 * Pure — unit tested without subprocesses.
 */
export function mapDoctorReport(
  checks: DoctorCheckResult[],
  root: string,
  wanted: ReadonlySet<DoctorCheck>,
): { tickets: WorkTicket[]; warnings: string[] } {
  const tickets: WorkTicket[] = [];
  const warnings: string[] = [];
  const seq = { n: 0 };
  for (const check of checks) {
    const id = typeof check.id === "string" ? check.id : "";
    if (!isDoctorCheck(id) || !wanted.has(id)) continue;
    const mapped = mapDoctorCheck(check, root, seq);
    tickets.push(...mapped.tickets);
    warnings.push(...mapped.warnings);
  }
  return { tickets, warnings };
}

/**
 * Fetch tool-cluster findings via one `giwt doctor check --json` call.
 * Returns null when giwt is unavailable or the report is unusable — the
 * caller falls back to the direct per-tool runners.
 */
export async function fetchViaDoctor(
  pi: ExecLike,
  root: string,
  wanted: ReadonlySet<DoctorCheck>,
  timeoutMs: number = DOCTOR_TIMEOUT_MS,
): Promise<ToolFetch | null> {
  if (!giwtOnPath()) return null;
  const csv = [...DOCTOR_CHECKS].filter((c) => wanted.has(c)).join(",");
  if (!csv) return null;
  let out: string;
  try {
    out = await execTool(pi, "giwt", ["doctor", "check", "--json", "--checks", csv], timeoutMs);
  } catch {
    return null;
  }
  let checks: DoctorCheckResult[];
  try {
    checks = parseDoctorReport(out);
  } catch {
    return null;
  }
  return mapDoctorReport(checks, root, wanted);
}
