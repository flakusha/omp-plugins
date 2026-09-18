/**
 * `/find-work` pure classification: kind, priority, and domain derived from
 * tracker labels and ticket titles.
 */

import {
  DEFAULT_PRIORITY,
  LABEL_KINDS,
  LABEL_PRIORITY_PREFIX_RE,
  LABEL_PRIORITY_RE,
  RECEIPT_ID_PREFIX_RE,
  SEVERITY_PRIORITIES,
  TITLE_KIND_PREFIX_RE,
} from "./keywords";
import type { TicketKind } from "./types";

// ---------------------------------------------------------------------------
// Pure classification
// ---------------------------------------------------------------------------

/** Kind from a ticket's labels, then title prefix. Defaults to `task`. */
export function classifyKind(labels: string[], title: string): TicketKind {
  for (const label of labels) {
    const kind = LABEL_KINDS[label.toLowerCase()];
    if (kind) return kind;
  }
  const m = TITLE_KIND_PREFIX_RE.exec(title);
  if (m?.[1]) {
    const word = m[1].toLowerCase();
    if (word === "fix" || word === "bug") return "bug";
    if (word === "feat" || word === "feature") return "feature";
    if (word === "epic") return "epic";
    return "task";
  }
  return "task";
}

/** Priority from P-labels, `priority: PN` labels, then severity words. */
export function classifyPriority(labels: string[]): string {
  for (const label of labels) {
    const direct = LABEL_PRIORITY_RE.exec(label) ?? LABEL_PRIORITY_PREFIX_RE.exec(label);
    if (direct?.[1] !== undefined) return `P${direct[1]}`;
    const severity = SEVERITY_PRIORITIES[label.toLowerCase()];
    if (severity) return severity;
  }
  return DEFAULT_PRIORITY;
}

/** First label that is neither a kind nor a priority/severity marker. */
export function domainOf(labels: string[], fallbackSource: string): string {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (LABEL_KINDS[lower]) continue;
    if (LABEL_PRIORITY_RE.test(label) || LABEL_PRIORITY_PREFIX_RE.test(label)) continue;
    if (SEVERITY_PRIORITIES[lower]) continue;
    return lower;
  }
  return fallbackSource;
}

/** Receipt ledger ids (F-01, B-00, I-2 …) hint a kind by their letter prefix. */
export function kindFromReceiptId(id: string | undefined): TicketKind {
  const m = id ? RECEIPT_ID_PREFIX_RE.exec(id) : undefined;
  const letter = m?.[1]?.toUpperCase();
  if (letter === "B") return "bug";
  if (letter === "F") return "feature";
  if (letter === "E") return "epic";
  return "task";
}
