// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * Receipt carry chores — counter bump, prune/stamp, atomic write, state
 * edits. Split out of `receipt.ts`; see that file for the carriage overview.
 */

import { renameSync, writeFileSync } from "node:fs";
import {
  type CarryResult,
  isFinished,
  parseReceipt,
  RECEIPT_KEEP,
  type ReceiptDoc,
  type ReceiptEntry,
  renderFooter,
} from "./receipt-doc";

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
