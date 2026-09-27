/**
 * `/find-work` labeling, grouping, and rendering: display labels per scheme,
 * domain batches, the flat list and markdown table renderers, and the ask
 * dialog question/index builders.
 */

import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import { DEFAULT_PAGE, MAX_TITLE, TABLE_TITLE } from "./keywords";
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

/** One selectable ask-dialog page: a tag/topic slice of the ticket pool. */
export interface AskPageOption {
  /** `assets` for a tag's first page, `assets:1`, `assets:2` for later ones. */
  label: string;
  description: string;
  tickets: WorkTicket[];
}

/** Char budget for one ask-page description before collapsing to `+N more`. */
const PAGE_DESC_BUDGET = 220;

/**
 * Human-readable page summary: leading ticket ids + clipped titles so the
 * ask dialog shows what is actually inside each selectable page, not just a
 * count. Budget-capped; remaining tickets collapse into `+N more`.
 */
export function describePage(tickets: WorkTicket[]): string {
  const parts: string[] = [];
  let len = 0;
  let shown = 0;
  for (const t of tickets) {
    const part = `${t.id} ${clip(t.title, 60)}`;
    if (parts.length > 0 && len + part.length > PAGE_DESC_BUDGET) break;
    parts.push(part);
    len += part.length + 3;
    shown++;
  }
  const rest = tickets.length - shown;
  return parts.join(" · ") + (rest > 0 ? ` · +${rest} more` : "");
}

/**
 * Chunk each domain (tag/topic) into `page`-sized selectable slices. The
 * first page of a domain keeps the bare tag name; later pages get a 1-based
 * suffix (`assets:1`). Labels deliberately carry no issue counts.
 */
export function pageDomainOptions(labeled: LabeledTicket[], page: number): AskPageOption[] {
  const size = Math.max(1, Math.floor(page));
  const out: AskPageOption[] = [];
  for (const [domain, items] of groupBatches(labeled)) {
    for (let i = 0; i < items.length; i += size) {
      const slice = items.slice(i, i + size);
      out.push({
        label: i === 0 ? domain : `${domain}:${i / size}`,
        description: describePage(slice.map((item) => item.ticket)),
        tickets: slice.map((item) => item.ticket),
      });
    }
  }
  return out;
}

/**
 * Ask dialog: one multi-select question whose options are the paged
 * tag/topic slices (`assets`, `assets:1`, …). The exact option label is
 * returned in `selectedOptions`, so `buildLabelIndex` maps it back to the
 * page's tickets.
 */
export function buildAskQuestions(
  labeled: LabeledTicket[],
  page: number = DEFAULT_PAGE,
): ExtensionAskDialogQuestion[] {
  const options = pageDomainOptions(labeled, page);
  if (options.length === 0) return [];
  return [
    {
      id: "tickets",
      header: "tickets",
      question: "Which group of tickets should this batch take on?",
      multi: true,
      options: options.map((opt) => ({ label: opt.label, description: opt.description })),
    },
  ];
}

/** Map ask-dialog option labels back to their page of tickets. */
export function buildLabelIndex(
  labeled: LabeledTicket[],
  page: number = DEFAULT_PAGE,
): Map<string, WorkTicket[]> {
  const index = new Map<string, WorkTicket[]>();
  for (const opt of pageDomainOptions(labeled, page)) index.set(opt.label, opt.tickets);
  return index;
}
