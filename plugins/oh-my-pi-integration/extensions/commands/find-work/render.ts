/**
 * `/find-work` labeling, grouping, and rendering: display labels per scheme,
 * domain batches, the flat list and markdown table renderers, and the ask
 * dialog question/index builders.
 */

import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import { MAX_TITLE, TABLE_TITLE } from "./keywords";
import type { LabeledTicket, LabelScheme, TicketKind, WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// Labeling, grouping, rendering
// ---------------------------------------------------------------------------

/** Bijective base-26 label: A..Z, AA, AB, … (unique for any count). */
export function letterLabel(seq: number): string {
  let n = seq + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Assign display labels per scheme. Unique for order/letters/types. */
export function labelTickets(tickets: WorkTicket[], scheme: LabelScheme): LabeledTicket[] {
  const kindCounters = new Map<TicketKind, number>();
  return tickets.map((ticket, seq) => {
    let label: string;
    if (scheme === "order") label = String(seq + 1);
    else if (scheme === "letters") label = letterLabel(seq);
    else if (scheme === "priorities") label = ticket.priority;
    else {
      const next = (kindCounters.get(ticket.kind) ?? 0) + 1;
      kindCounters.set(ticket.kind, next);
      label = `${ticket.kind[0]?.toUpperCase() ?? "T"}${next}`;
    }
    return { ticket, label };
  });
}

/** Group labeled tickets by domain, preserving first-appearance order. */
export function groupBatches(labeled: LabeledTicket[]): Map<string, LabeledTicket[]> {
  const groups = new Map<string, LabeledTicket[]>();
  for (const item of labeled) {
    const bucket = groups.get(item.ticket.domain);
    if (bucket) bucket.push(item);
    else groups.set(item.ticket.domain, [item]);
  }
  return groups;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function itemLine(item: LabeledTicket): string {
  const t = item.ticket;
  const via = t.matchedVia ? `, match: ${t.matchedVia}` : "";
  return `${item.label}. ${t.id} — ${clip(t.title, MAX_TITLE)} (${t.source}, ${t.kind}, ${t.priority}${via})`;
}

/** Flat numbered list; `batches` inserts a header per domain. */
export function renderList(labeled: LabeledTicket[], batches: boolean): string {
  const sources = [...new Set(labeled.map((i) => i.ticket.source))];
  const lines = [`found ${labeled.length} open work item(s) (sources: ${sources.join(", ")})`];
  if (batches) {
    for (const [domain, items] of groupBatches(labeled)) {
      lines.push(`— ${domain} (${items.length}) —`);
      for (const item of items) lines.push(itemLine(item));
    }
  } else {
    for (const item of labeled) lines.push(itemLine(item));
  }
  return lines.join("\n");
}

/** Markdown table; `batches` prepends a domain column. */
export function renderTable(labeled: LabeledTicket[], batches: boolean): string {
  const header = batches
    ? ["domain", "label", "id", "title", "source", "kind", "prio"]
    : ["label", "id", "title", "source", "kind", "prio"];
  const lines = [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`];
  for (const { ticket, label } of labeled) {
    const cells = [
      ...(batches ? [ticket.domain] : []),
      label,
      ticket.id,
      clip(ticket.title, TABLE_TITLE),
      ticket.source,
      ticket.kind,
      ticket.priority,
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Exact option-label string used by both the ask dialog and the index. */
function askOptionLabel(item: LabeledTicket): string {
  return `${item.label} ${item.ticket.id} — ${clip(item.ticket.title, TABLE_TITLE)}`;
}

/**
 * Ask questions grouped by domain — one multi-select question per group,
 * options labeled `<label> <id> — <title>` (the exact string returned in
 * `selectedOptions`, so `buildLabelIndex` can map back to tickets).
 */
export function buildAskQuestions(labeled: LabeledTicket[]): ExtensionAskDialogQuestion[] {
  const questions: ExtensionAskDialogQuestion[] = [];
  for (const [domain, items] of groupBatches(labeled)) {
    questions.push({
      id: domain.replace(/[^a-z0-9-]+/g, "-") || "domain",
      header: domain,
      question: `Which ${domain} tickets should this batch take on?`,
      multi: true,
      options: items.map((item) => ({
        label: askOptionLabel(item),
        description: `${item.ticket.kind}, ${item.ticket.priority} (${item.ticket.source})`,
      })),
    });
  }
  return questions;
}

/** Map ask-dialog option labels back to their tickets. */
export function buildLabelIndex(labeled: LabeledTicket[]): Map<string, WorkTicket> {
  const index = new Map<string, WorkTicket>();
  for (const item of labeled) index.set(askOptionLabel(item), item.ticket);
  return index;
}
