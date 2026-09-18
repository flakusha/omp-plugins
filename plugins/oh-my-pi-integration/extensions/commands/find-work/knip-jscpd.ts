/**
 * `/find-work` knip + jscpd cluster: unused-code and duplicated-code output
 * parsers plus their direct runners.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSCPD_TIMEOUT_MS, KNIP_TIMEOUT_MS, TOOL_MAX_TICKETS } from "./keywords";
import { type ExecLike, execTool, pad2, relToRoot, type ToolCap, toolBin } from "./tool-exec";
import type { WorkTicket } from "./types";

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

/** Run knip (JSON reporter, alternate cwd) and map unused-code findings. */
export async function runKnip(
  pi: ExecLike,
  root: string,
  cap: ToolCap = () => Number.POSITIVE_INFINITY,
): Promise<WorkTicket[]> {
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
    cap(KNIP_TIMEOUT_MS),
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
export async function runJscpd(
  pi: ExecLike,
  root: string,
  cap: ToolCap = () => Number.POSITIVE_INFINITY,
): Promise<WorkTicket[]> {
  const outDir = mkdtempSync(join(tmpdir(), "find-work-jscpd-"));
  try {
    const cfg = join(root, ".jscpd.json");
    // NOTE: no --exit-code flag — its spelling differs across jscpd
    // versions (--exit-code vs --exitCode) and the status is unused here:
    // findings come from the report file, execTool recovers its stdout.
    const args = [
      "--silent",
      "-r",
      "json",
      "-o",
      outDir,
      "-f",
      JSCPD_FORMATS,
      ...(existsSync(cfg) ? ["-c", cfg] : []),
      root,
    ];
    await execTool(pi, toolBin(root, "jscpd"), args, cap(JSCPD_TIMEOUT_MS));
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(outDir, "jscpd-report.json"), "utf8"));
    } catch {
      throw new Error("jscpd: report unreadable");
    }
    return parseJscpdReport(data)
      .slice(0, TOOL_MAX_TICKETS)
      .map((c, i) => {
        // Configs may report absolute paths ("absolute": true) — relativize.
        const a = relToRoot(root, c.a);
        const b = relToRoot(root, c.b);
        return {
          id: `CPD-${pad2(i)}`,
          title: `${c.lines} duplicated lines: ${a}:${c.lineA} ↔ ${b}:${c.lineB}`,
          source: "jscpd",
          kind: "task" as const,
          priority: "P3",
          domain: "duplication",
        };
      });
  } finally {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* scratch cleanup is best-effort */
    }
  }
}
