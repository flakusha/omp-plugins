/**
 * `/find-work` roster sources backed by repo state: the receipt ledger
 * (giwt job entries) and `.plan/*.md` tickets/epics/backlog files.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReceiptDoc } from "../../receipt/receipt";
import { DEFAULT_STATE, parseReceipt } from "../../receipt/receipt";
import { resolveGiwtConfig, resolvePlanDir } from "../../util/giwt-config";
import { readPlanLabels } from "../../util/plan-frontmatter";
import { classifyKind, classifyPriority, domainOf, kindFromReceiptId } from "./classify";
import {
  DEFAULT_PRIORITY,
  HEADING_RE,
  KEY_VALUE_RE,
  PLAN_EPIC_HEADER_RE,
  STATUS_DONE_RE,
  STATUS_LINE_RE,
} from "./keywords";
import type { TicketKind, WorkTicket } from "./types";

/** Value of the entry's first `key =` line inside the ledger, unquoted. */
function receiptEntryTitle(doc: ReceiptDoc, firstKey: string): string {
  for (const line of doc.lines) {
    const m = KEY_VALUE_RE.exec(line);
    if (m?.[1] === firstKey) {
      const raw = m[2] ?? "";
      const unquoted = raw.replace(/^"(.*)"$/, "$1").trim();
      if (unquoted) return unquoted;
    }
  }
  return firstKey;
}

/** Open (non-finished) ledger jobs become receipt tickets. */
export function receiptTickets(root: string): WorkTicket[] {
  const path = resolveGiwtConfig(root).receiptPath;
  if (!existsSync(path)) return [];
  const doc = parseReceipt(readFileSync(path, "utf8"));
  const tickets: WorkTicket[] = [];
  for (const entry of doc.entries) {
    if (entry.table !== "job" || !entry.firstKey) continue;
    const state = (entry.state ?? DEFAULT_STATE).trim().toLowerCase();
    if (state === "finished") continue;
    const title = receiptEntryTitle(doc, entry.firstKey);
    tickets.push({
      id: entry.firstKey,
      title,
      source: "receipt",
      kind: kindFromReceiptId(entry.firstKey),
      priority: DEFAULT_PRIORITY,
      domain: "receipt",
    });
  }
  return tickets;
}

const PLAN_DIRS: Array<{ dir: "tickets" | "epics" | "backlog"; kind: TicketKind }> = [
  { dir: "tickets", kind: "task" },
  { dir: "epics", kind: "epic" },
  { dir: "backlog", kind: "task" },
];

/** Parse one `.plan/*.md` file into a ticket, or null when done/unreadable. */
function planFileTicket(
  abs: string,
  file: string,
  dir: string,
  kind: TicketKind,
): WorkTicket | null {
  const path = join(abs, file);
  let text: string;
  try {
    if (!statSync(path).isFile()) return null;
    text = readFileSync(path, "utf8").slice(0, 4096);
  } catch {
    return null;
  }
  const lines = text.split("\n");
  const heading = lines.find((line) => HEADING_RE.test(line));
  const id = file.replace(/\.md$/, "");
  const title = heading ? (HEADING_RE.exec(heading)?.[1] ?? "").trim() : id;
  const labels = readPlanLabels(text);
  // Epic binding per the .plan format spec: `**Epic:** <name>` inside the
  // header region (first 30 lines — the same bound as giwt's parseTicketFile;
  // body prose must never pollute the field).
  const epicLine = lines.slice(0, 30).find((line) => PLAN_EPIC_HEADER_RE.test(line));
  const epic = epicLine ? (PLAN_EPIC_HEADER_RE.exec(epicLine)?.[1] ?? "").trim() : "";
  // Reconciled tickets may carry multiple status lines (legacy + follow-up
  // marker); ANY done-looking line closes the ticket (BUG-find-work-closed-
  // epic-reconciliation-stubs-leak-into-roster).
  const statusValues = lines
    .filter((line) => STATUS_LINE_RE.test(line))
    .map((line) => STATUS_LINE_RE.exec(line)?.[1] ?? "");
  if (statusValues.some((v) => STATUS_DONE_RE.test(v))) return null; // labels never bypass done-detection
  const fromMeta = classifyKind(labels, title);
  return {
    id,
    title: title || id,
    source: ".plan",
    // Dir default applies only when labels/title yield no stronger kind.
    kind: fromMeta === "task" ? kind : fromMeta,
    priority: classifyPriority(labels),
    domain: domainOf(labels, dir),
    tags: labels,
    epic: epic || undefined,
  };
}

/** `.plan/{tickets,epics,backlog}/*.md` — heading title, done-status skip. */
export function planTickets(root: string): WorkTicket[] {
  const tickets: WorkTicket[] = [];
  for (const { dir, kind } of PLAN_DIRS) {
    const abs = resolvePlanDir(root, dir);
    let files: string[];
    try {
      files = readdirSync(abs);
    } catch {
      continue;
    }
    files.sort(); // deterministic order — readdirSync returns fs-hash order
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const ticket = planFileTicket(abs, file, dir, kind);
      if (ticket) tickets.push(ticket);
    }
  }
  return tickets;
}
