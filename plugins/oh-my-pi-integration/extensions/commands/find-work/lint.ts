/**
 * `/find-work` lint cluster: eslint/biome/oxlint output parsers plus the
 * runner that executes whichever linter the repo configures.
 */

import { LINT_TIMEOUT_MS, TOOL_MAX_TICKETS } from "./keywords";
import { detectLintTool } from "./sources";
import { type ExecLike, execTool, pad2, relToRoot, type ToolCap, toolBin } from "./tool-exec";
import type { WorkTicket } from "./types";

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
    const filePath = relToRoot(root, f.filePath);
    for (const raw of f.messages) {
      const m = raw as { ruleId?: unknown; severity?: unknown; message?: unknown; line?: unknown };
      out.push(eslintFinding(m, filePath));
    }
  }
  return out;
}

/** Project one raw eslint message entry into a finding. */
function eslintFinding(
  m: { ruleId?: unknown; severity?: unknown; message?: unknown; line?: unknown },
  file: string,
): EslintFinding {
  return {
    file,
    line: typeof m.line === "number" ? m.line : 0,
    rule: typeof m.ruleId === "string" && m.ruleId ? m.ruleId : "eslint",
    message: typeof m.message === "string" ? m.message : "",
    error: m.severity === 2,
  };
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
    out.push(oxlintFinding(d, root));
  }
  return out;
}

/** Project one raw oxlint diagnostic entry into a finding. */
function oxlintFinding(
  d: {
    message?: unknown;
    code?: unknown;
    severity?: unknown;
    filename?: unknown;
    labels?: unknown;
  },
  root: string,
): OxlintFinding {
  const spans = Array.isArray(d.labels) ? d.labels : [];
  const first = spans[0] as { span?: { line?: unknown } } | undefined;
  const line = first?.span && typeof first.span.line === "number" ? first.span.line : 0;
  return {
    file: typeof d.filename === "string" ? relToRoot(root, d.filename) : "",
    line,
    rule: typeof d.code === "string" && d.code ? d.code : "oxlint",
    message: typeof d.message === "string" ? d.message : "",
    error: d.severity === "error",
  };
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
export async function runLintCluster(
  pi: ExecLike,
  root: string,
  cap: ToolCap = () => Number.POSITIVE_INFINITY,
): Promise<WorkTicket[]> {
  const tool = detectLintTool(root);
  if (!tool) return [];
  if (tool === "eslint") {
    const out = await execTool(
      pi,
      toolBin(root, "eslint"),
      ["--format", "json", root],
      cap(LINT_TIMEOUT_MS),
    );
    if (!out.trim()) return [];
    return lintFindingTickets(parseEslintJson(out, root), "LT");
  }
  if (tool === "oxlint") {
    const out = await execTool(
      pi,
      toolBin(root, "oxlint"),
      ["--format", "json", root],
      cap(LINT_TIMEOUT_MS),
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
