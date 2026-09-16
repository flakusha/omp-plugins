// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * giwt ledger bridge — read giwt's .ledger.jsonl as receipt-compatible
 * entries for omp's /receipt and receipt carriage.
 *
 * giwt writes one compact JSONL record per CLI invocation to
 * `<treeDir>/.ledger.jsonl`. Records are immutable (append-only), so
 * receipt state ("finished") cannot be written back — giwt-ledger
 * entries are read-only reference.
 *
 * Mapping:
 *   LedgerRecord → receipt-compatible entry with id "GL-{index}",
 *   summary from record.msg, state always "observed".
 *
 * Best-effort by contract: a missing/corrupt ledger returns [] silently.
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Local type mirroring giwt's LedgerRecord (v1 schema). Avoids a hard
 * dependency on the giwt package at type-check time — the runtime shape
 * is validated by the `parsed.v === 1` check in `readGiwtLedger`.
 */
interface LedgerRecord {
  v: 1;
  ts: string;
  pid: number;
  cmd: string;
  branch: string;
  msg: string;
}

export interface GiwtLedgerEntry {
  id: string;
  table: "job";
  state: "observed";
  summary: string;
  ts: string;
  cmd: string;
  branch: string;
  pid: number;
}

const GIWT_LEDGER_FILENAME = ".ledger.jsonl";
const MAX_LEDGER_ENTRIES = 30;

/**
 * Read giwt ledger records from a tree dir. Returns newest-first.
 * Returns [] when the ledger is missing, empty, or corrupt.
 */
export function readGiwtLedger(
  treeDir: string,
  maxEntries: number = MAX_LEDGER_ENTRIES,
): GiwtLedgerEntry[] {
  const path = `${treeDir}/${GIWT_LEDGER_FILENAME}`;
  if (!existsSync(path)) return [];

  let lines: string[];
  try {
    lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }

  const records: LedgerRecord[] = [];
  for (const line of lines.slice(-maxEntries)) {
    try {
      const parsed = JSON.parse(line) as LedgerRecord;
      if (parsed && parsed.v === 1 && typeof parsed.msg === "string") {
        records.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }

  // Newest first for work discovery
  return records.reverse().map((r, i) => ({
    id: `GL-${String(i + 1).padStart(2, "0")}`,
    table: "job" as const,
    state: "observed" as const,
    summary: r.msg,
    ts: r.ts,
    cmd: r.cmd,
    branch: r.branch,
    pid: r.pid,
  }));
}

/**
 * Format giwt ledger entries as receipt footer lines.
 * Returns [] when the ledger is empty.
 */
export function formatGiwtLedgerFooter(entries: GiwtLedgerEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines: string[] = ["[giwt ledger]"];
  for (const e of entries.slice(0, 12)) {
    const shortTs = e.ts.slice(5, 16).replace("T", " ");
    const branch = e.branch || "-";
    lines.push(`  ${e.id} [${shortTs}] [${branch}] ${e.cmd}: ${e.summary.slice(0, 80)}`);
  }
  if (entries.length > 12) lines.push(`  …(${entries.length - 12} more)`);
  return lines;
}

/**
 * Resolve giwt ledger path from session cwd. Returns undefined when giwt
 * is not configured (no giwt.toml, no .tmp/giwt dir).
 */
export function resolveGiwtLedgerPath(cwd: string | undefined): string | undefined {
  const root = cwd ?? process.cwd();
  const treeDir = `${root}/tree`;
  const ledgerPath = `${treeDir}/${GIWT_LEDGER_FILENAME}`;
  if (existsSync(ledgerPath)) return ledgerPath;
  return undefined;
}
