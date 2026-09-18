/**
 * `/find-work` typecheck + test cluster: `tsc --noEmit` and test-runner
 * output parsers plus their direct runners.
 */

import { onPath } from "../bookkeep";
import { TESTS_TIMEOUT_MS, TOOL_MAX_TICKETS, TYPECHECK_TIMEOUT_MS } from "./keywords";
import { type ExecLike, execTool, pad2, relToRoot, type ToolCap, toolBin } from "./tool-exec";
import type { WorkTicket } from "./types";

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

/** Run `tsc --noEmit` and map errors to P1 bug tickets. */
export async function runTypecheck(
  pi: ExecLike,
  root: string,
  cap: ToolCap = () => Number.POSITIVE_INFINITY,
): Promise<WorkTicket[]> {
  const out = await execTool(
    pi,
    toolBin(root, "tsc"),
    ["--noEmit", "-p", root],
    cap(TYPECHECK_TIMEOUT_MS),
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
export async function runTests(
  pi: ExecLike,
  root: string,
  cap: ToolCap = () => Number.POSITIVE_INFINITY,
): Promise<WorkTicket[]> {
  // NOTE: pi.exec has no cwd option — like the gh/git-issue calls below,
  // this assumes the process cwd is the session repo (see completions.ts).
  void root;
  const bin = onPath("bun") ? "bun" : "npm";
  const args = bin === "bun" ? ["run", "test"] : ["test", "--silent"];
  const out = await execTool(pi, bin, args, cap(TESTS_TIMEOUT_MS));
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
