// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * Receipt document model — line-preserving parse and footer rendering.
 * Split out of `receipt.ts`; see that file for the carriage overview.
 */

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

export function isFinished(entry: ReceiptEntry): boolean {
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
