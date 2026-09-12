/**
 * Receipt carriage — carry `<project>/.omp/receipt.toml` into the agent loop.
 *
 * The receipt is a small TOML job ledger the agent maintains across turns:
 *
 *   [[job]]
 *   F-01 = "feature `make the cicd happy` is finished"
 *   [[job]]
 *   F-02 = "improve database performance"
 *   state = "in progress"
 *   [[issue]]
 *   tooling = "failed to access `.tmp/report.json`"
 *
 * No strict spec: tables are `[[job]]` / `[[issue]]` (plus plugin-managed
 * `[carriage]`), each entry's first key is its id, `state` is recognized,
 * and everything else (comments, unknown keys) is preserved verbatim.
 *
 * Every carry ("receipt"):
 *   1. bumps `[carriage] n`,
 *   2. stamps finished jobs with `done_at = <n>` on their first finished carry,
 *   3. prunes finished jobs once `n - done_at >= RECEIPT_KEEP`,
 *   4. prunes empty entries (comment-only `[[table]]` blocks).
 *
 * Chores are line-oriented (not a re-serialize) so human comments survive.
 * Everything is fail-open: any parse or IO problem means no footer and no
 * write — the agent loop is never blocked by the ledger.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomMessagePayload } from "@oh-my-pi/pi-coding-agent";

/** Finished jobs are carried at most this many receipts before pruning. */
export const RECEIPT_KEEP = 3;

/** Hard cap on rendered footer lines (context-budget guard). */
export const RECEIPT_MAX_LINES = 30;

/** State assumed when a job carries no `state = "…"` line. */
export const DEFAULT_STATE = "in progress";

type EntryTable = "job" | "issue";

export interface ReceiptEntry {
  table: EntryTable;
  /** Inclusive line range of the entry block (header line .. last body line). */
  start: number;
  end: number;
  /** First `key =` in the block (the id, e.g. `F-01`); undefined for empty blocks. */
  firstKey?: string;
  state?: string;
  doneAt?: number;
  /** A `# … Blocker …` comment inside the block. */
  blocker: boolean;
}

export interface ReceiptDoc {
  lines: string[];
  /** `[carriage] n` value; 0 when absent. */
  n: number;
  /** Line index of the `n =` line inside `[carriage]`, or -1 when absent. */
  nLine: number;
  /** Line index of a `[carriage]` header, or -1 when absent. */
  carriageLine: number;
  entries: ReceiptEntry[];
}

export interface CarryResult {
  /** Updated document text (chores applied). */
  text: string;
  /** Footer body lines to carry; `[receipt n=…]` first; length 1 = no entries. */
  footer: string[];
  n: number;
}

const HEADER_RE = /^\s*\[\[(job|issue)\]\]\s*$/;
const CARRIAGE_RE = /^\s*\[carriage\]\s*$/;
const OTHER_TABLE_RE = /^\s*\[[^[]/;
const KEY_RE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/;
const BASIC_STRING_RE = /^"((?:[^"\\]|\\.)*)"\s*$/;

function isEntryTable(value: string | undefined): value is EntryTable {
  return value === "job" || value === "issue";
}

/** Strip one layer of TOML basic-string quoting; other values pass through. */
function unquote(raw: string): string {
  const m = BASIC_STRING_RE.exec(raw);
  if (!m?.[1]) return raw;
  return m[1].replace(/\\(.)/g, "$1");
}

/** Classify one `key = value` body line against the entry/carriage state. */
function applyKeyLine(
  doc: ReceiptDoc,
  current: ReceiptEntry | null,
  inCarriage: boolean,
  line: string,
  index: number,
): void {
  const kv = KEY_RE.exec(line);
  if (!kv?.[1]) return;
  const key = kv[1];
  const rawValue = kv[2] ?? "";
  if (inCarriage) {
    if (key === "n" && /^\d+$/.test(rawValue)) {
      doc.n = Number(rawValue);
      doc.nLine = index;
    }
    return;
  }
  if (!current) return;
  if (current.firstKey === undefined) current.firstKey = key;
  if (key === "state") current.state = unquote(rawValue);
  else if (key === "done_at" && /^\d+$/.test(rawValue)) current.doneAt = Number(rawValue);
}

/** Parse receipt TOML text into a line-preserving doc model. Malformed input is tolerated. */
export function parseReceipt(text: string): ReceiptDoc {
  const lines = text.split("\n");
  const doc: ReceiptDoc = { lines, n: 0, nLine: -1, carriageLine: -1, entries: [] };
  let current: ReceiptEntry | null = null;
  let inCarriage = false;

  for (const [index, line] of lines.entries()) {
    const header = HEADER_RE.exec(line);
    if (header && isEntryTable(header[1])) {
      current = { table: header[1], start: index, end: index, blocker: false };
      doc.entries.push(current);
      inCarriage = false;
      continue;
    }
    if (CARRIAGE_RE.test(line)) {
      inCarriage = true;
      doc.carriageLine = index;
      current = null;
      continue;
    }
    if (OTHER_TABLE_RE.test(line)) {
      // Any other `[table]` ends the current block without opening an entry.
      inCarriage = false;
      current = null;
      continue;
    }
    if (current && /(^|\s)#\s*blocker\b/i.test(line)) current.blocker = true;
    if (current && line.trim() !== "") current.end = index;
    applyKeyLine(doc, current, inCarriage, line, index);
  }
  return doc;
}

function isFinished(entry: ReceiptEntry): boolean {
  return (entry.state ?? DEFAULT_STATE).trim().toLowerCase() === "finished";
}

/** Render one entry as a compact footer line; null when it carries nothing. */
function renderEntry(doc: ReceiptDoc, entry: ReceiptEntry): string | null {
  if (entry.firstKey === undefined) return null; // empty block
  const payload: string[] = [];
  for (const line of doc.lines.slice(entry.start + 1, entry.end + 1)) {
    const kv = KEY_RE.exec(line);
    if (!kv?.[1]) continue; // comments/blanks are context, not payload
    if (kv[1] === "state" || kv[1] === "done_at") continue; // carried via the label
    payload.push(`${kv[1]}: ${unquote(kv[2] ?? "")}`);
  }
  if (payload.length === 0) return null;
  const label =
    entry.table === "job"
      ? isFinished(entry)
        ? "job finished"
        : `job (${entry.state ?? DEFAULT_STATE})`
      : "issue";
  const flag = entry.blocker ? " [blocker]" : "";
  return `${label}${flag} ${payload.join("; ")}`;
}

/** Render the compact footer body lines for all surviving entries. */
export function renderFooter(doc: ReceiptDoc): string[] {
  const out: string[] = [`[receipt n=${doc.n}]`];
  for (const entry of doc.entries) {
    const line = renderEntry(doc, entry);
    if (line) out.push(line);
  }
  return out;
}

/**
 * Bump `[carriage] n` to `n`, preserving layout: rewrite the existing `n =`
 * Bump `[carriage] n` to `n`, preserving layout: rewrite the existing `n =`
 * line, insert under an existing `[carriage]` header, or prepend a new table
 * after any leading comment block. Returns the number of lines inserted
 * (callers must shift parsed entry indices by it).
 */
function bumpCarriage(lines: string[], doc: ReceiptDoc, n: number): number {
  if (doc.nLine >= 0) {
    lines[doc.nLine] = `n = ${n}`;
    return 0;
  }
  if (doc.carriageLine >= 0) {
    const at = doc.carriageLine + 1;
    lines.splice(at, 0, `n = ${n}`);
    doc.nLine = at;
    return 1;
  }
  let insertAt = 0;
  while (insertAt < lines.length && /^\s*(#|$)/.test(lines[insertAt] ?? "")) insertAt += 1;
  lines.splice(insertAt, 0, "[carriage]", `n = ${n}`, "");
  doc.carriageLine = insertAt;
  doc.nLine = insertAt + 1;
  return 3;
}

/** Decide a single entry's chore for this carry. */
function choreFor(entry: ReceiptEntry, n: number, keep: number): "prune" | "stamp" | "keep" {
  if (entry.firstKey === undefined) return "prune"; // empty block
  if (entry.table !== "job" || !isFinished(entry)) return "keep";
  if (entry.doneAt === undefined) return "stamp";
  return n - entry.doneAt >= keep ? "prune" : "keep";
}

/**
 * Pure carry: bump the receipt counter, apply pruning/stamping chores
 * (descending line order so index math stays trivial), render the footer.
 */
export function carry(text: string, keep = RECEIPT_KEEP): CarryResult {
  const doc = parseReceipt(text);
  const n = doc.n + 1;
  const delta = bumpCarriage(doc.lines, doc, n);
  doc.n = n;
  // Inserted carriage lines shift every parsed entry downward.
  if (delta > 0) {
    for (const entry of doc.entries) {
      entry.start += delta;
      entry.end += delta;
    }
  }
  for (const entry of [...doc.entries].sort((a, b) => b.start - a.start)) {
    const chore = choreFor(entry, n, keep);
    if (chore === "prune") {
      doc.lines.splice(entry.start, entry.end - entry.start + 1);
    } else if (chore === "stamp") {
      doc.lines.splice(entry.end + 1, 0, `done_at = ${n}`);
      entry.doneAt = n;
    }
  }

  // Chores mutate lines, so render from a fresh parse of the final text
  // instead of the stale (pre-splice) entry indices.
  const out = doc.lines.join("\n");
  return { text: out, footer: renderFooter(parseReceipt(out)), n };
}

/** Atomic text replace (tmp + rename). */
export function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * Set an entry's `state` line, preserving layout and comments: rewrite the
 * existing `state = …` line in place, or append one when the block has none.
 * Matches the entry by its first key (case-insensitive). Returns the updated
 * text, or undefined when no entry carries that id.
 */
export function setEntryState(text: string, id: string, state: string): string | undefined {
  const doc = parseReceipt(text);
  const want = id.trim().toLowerCase();
  const entry = doc.entries.find((e) => e.firstKey?.toLowerCase() === want);
  if (!entry) return undefined;
  const lines = [...doc.lines];
  for (let i = entry.start + 1; i <= entry.end; i++) {
    const m = /^(\s*)state\s*=\s*.*$/.exec(lines[i] ?? "");
    if (m) {
      lines[i] = `${m[1]}state = "${state}"`;
      return lines.join("\n");
    }
  }
  lines.splice(entry.end + 1, 0, `state = "${state}"`);
  return lines.join("\n");
}

/**
 * Carry the project receipt: read `<cwd>/.omp/receipt.toml`, apply chores,
 * write back atomically, and return the footer message injection for
 * `before_agent_start`. Fail-open: any problem → undefined, file untouched
 * (or footer-only when only the write failed).
 */
export async function carryReceipt(
  cwd: string | undefined,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<{ message: CustomMessagePayload } | undefined> {
  if (!cwd || env.PI_RECEIPT_DISABLE === "1") return undefined;
  const path = join(cwd, ".omp", "receipt.toml");
  if (!existsSync(path)) return undefined;

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  let result: CarryResult;
  try {
    result = carry(text);
  } catch {
    return undefined; // malformed beyond tolerance: fail open, never write
  }
  if (result.footer.length <= 1) return undefined; // no entries: no carry, no churn

  try {
    atomicWrite(path, result.text);
  } catch {
    /* read-only receipt: still carry the footer this turn */
  }

  let footer = result.footer.join("\n");
  if (result.footer.length > RECEIPT_MAX_LINES) {
    footer = `${result.footer.slice(0, RECEIPT_MAX_LINES).join("\n")}\n…(truncated)`;
  }
  return {
    message: {
      customType: "omp-receipt",
      content:
        `Job receipt (carried from .omp/receipt.toml; update states as work ` +
        `progresses — finished jobs are pruned after ${RECEIPT_KEEP} receipts):\n${footer}`,
      display: false,
      attribution: "agent",
    },
  };
}
