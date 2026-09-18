/** Discovery of plannable item IDs from `.plan/{tickets,epics,backlog}`. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveGiwtConfig, resolvePlanDir } from "../../util/giwt-config";

/**
 * Status line filter: `**Status:** done`, `** Status: ** = …`, etc.
 * Anchored at the start of the captured value (after emoji / checkbox /
 * strikethrough decoration) so prose like `**Status:** Not Started
 * (planned, **not** done)` does not falsely trip on the trailing word.
 */
const DONE_STATUS_RE = /\*\*\s*([^*]+?)\s*\*\*\s*[:=]?\s*(.+)/gi;
const DONE_LEAD_RE =
  /^\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*|\[[^\]]*\]\s*|~~?\s*)?(done|fixed|complete[ds]?|closed|shipped|applied|finished|resolved|won'?t\s+(?:fix|do)|not-a-bug|deferred|cancelled|abandoned)\b/iu;

/**
 * Pure: IDs the user could target for audit/find/issue. Done items filtered.
 *
 * Walks `.plan/{tickets,epics,backlog}` for `*.md` files, drops any whose
 * bold-status line matches DONE_LEAD_RE. Implemented here (rather than via
 * `planTickets`) because `find-work` matches any status line anywhere in the
 * first 4 KiB, while `/bookkeep` only honors the bold line actually labeled
 * `status`. Both anchor the terminal-state word at the START of the decorated
 * value (emoji/bracket tag/strikethrough) so prose like "planned, **not**
 * done" or "In Progress (… fixed …)" keeps the item listed.
 */
export function discoverPlanningIds(root: string): string[] {
  const planRoot = resolveGiwtConfig(root).planDir;
  if (!existsSync(planRoot)) return [];
  const out: string[] = [];
  for (const dir of ["tickets", "epics", "backlog"] as const) {
    const full = resolvePlanDir(root, dir);
    if (!existsSync(full)) continue;
    let entries: string[];
    try {
      entries = readdirSync(full).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of entries) {
      const id = file.replace(/\.md$/, "");
      let body: string;
      try {
        body = readFileSync(join(full, file), "utf8");
      } catch {
        continue;
      }
      if (DONE_LEAD_RE.test(doneStatusValue(body))) continue;
      out.push(id);
    }
  }
  return out;
}

/**
 * Status value for a ticket body: the bold line actually labeled `status`
 * (any case) wins, so a decorative bold line elsewhere cannot shadow the real
 * status value; otherwise the first bold line's value is used.
 */
function doneStatusValue(body: string): string {
  let first = "";
  for (const m of body.matchAll(DONE_STATUS_RE)) {
    const value = (m[2] ?? "").trim();
    if (!first) first = value;
    if (/^status$/i.test((m[1] ?? "").trim().replace(/:$/, ""))) return value;
  }
  return first;
}
