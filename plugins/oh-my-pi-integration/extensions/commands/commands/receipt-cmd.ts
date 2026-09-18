/**
 * `/receipt` command internals: ledger status rendering, job completion,
 * tab completion over the TOML receipt, and the combined TOML + giwt ledger
 * footer. The registration itself lives in ../commands.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { formatGiwtLedgerFooter, readGiwtLedger } from "../../receipt/giwt-bridge";
import {
  atomicWrite,
  DEFAULT_STATE,
  parseReceipt,
  RECEIPT_MAX_LINES,
  renderFooter,
  setEntryState,
} from "../../receipt/receipt";
import { resolveGiwtConfig, resolveReceiptPath } from "../../util/giwt-config";

/** Render the ledger status for `/receipt` (no args): footer lines, bounded. */
export function renderReceiptStatus(text: string): string[] {
  const footer = renderFooter(parseReceipt(text));
  if (footer.length > RECEIPT_MAX_LINES) {
    return [...footer.slice(0, RECEIPT_MAX_LINES), "…(truncated)"];
  }
  return footer;
}

function receiptPath(cwd: string | undefined): string | undefined {
  return resolveReceiptPath(cwd);
}

/** Human-readable receipt path relative to cwd (for user messages). */
function receiptLabel(cwd: string | undefined): string {
  const path = receiptPath(cwd);
  if (!path) return "receipt.toml";
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

function readLedger(cwd: string | undefined): string | undefined {
  const path = receiptPath(cwd);
  if (!path || !existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function isFinishedState(state: string | undefined): boolean {
  return (state ?? DEFAULT_STATE).trim().toLowerCase() === "finished";
}

export async function showReceipt(ctx: ExtensionCommandContext): Promise<void> {
  // ── TOML receipt (job ledger with state) ──────────────────────────
  const text = readLedger(ctx.cwd);
  let tomlFooter: string[] = [];
  if (text !== undefined) {
    tomlFooter = renderReceiptStatus(text);
  }

  // ── giwt ledger (append-only agent activity, read-only) ──────────
  const giwtConfig = resolveGiwtConfig(ctx.cwd);
  const giwtEntries = giwtConfig.available ? readGiwtLedger(giwtConfig.treeDir) : [];
  const giwtFooter = formatGiwtLedgerFooter(giwtEntries);

  // ── Combine ───────────────────────────────────────────────────────
  const combined = [...tomlFooter, ...giwtFooter];

  if (
    combined.length === 0 ||
    (combined.length === 1 && tomlFooter.length <= 1 && giwtFooter.length === 0)
  ) {
    const msg =
      text === undefined && giwtFooter.length === 0
        ? `no job ledger yet (nothing recorded in ${receiptLabel(ctx.cwd)} or .ledger.jsonl)`
        : "job ledger is empty";
    ctx.ui.notify(msg, "info");
    return;
  }

  let footer = combined.join("\n");
  if (combined.length > RECEIPT_MAX_LINES) {
    footer = `${combined.slice(0, RECEIPT_MAX_LINES).join("\n")}\n…(truncated)`;
  }
  ctx.ui.notify(footer, "info");
}

export async function finishReceiptJob(id: string, ctx: ExtensionCommandContext): Promise<void> {
  const path = receiptPath(ctx.cwd);
  const text = readLedger(ctx.cwd);
  if (!path || text === undefined) {
    ctx.ui.notify(`no job ledger to update (${receiptLabel(ctx.cwd)} not found)`, "error");
    return;
  }
  const doc = parseReceipt(text);
  const entry = doc.entries.find((e) => e.firstKey?.toLowerCase() === id.toLowerCase());
  if (!entry?.firstKey) {
    const open = doc.entries
      .filter((e) => e.table === "job" && !isFinishedState(e.state) && e.firstKey)
      .map((e) => e.firstKey)
      .slice(0, 8);
    ctx.ui.notify(
      `no job '${id}' in the ledger${open.length > 0 ? ` (open: ${open.join(", ")})` : ""}`,
      "error",
    );
    return;
  }
  if (isFinishedState(entry.state)) {
    ctx.ui.notify(`${entry.firstKey} is already finished`, "info");
    return;
  }
  const next = setEntryState(text, entry.firstKey, "finished");
  if (next === undefined) {
    ctx.ui.notify(`no job '${id}' in the ledger`, "error");
    return;
  }
  try {
    atomicWrite(path, next);
  } catch {
    ctx.ui.notify(`cannot write ${path} (read-only?)`, "error");
    return;
  }
  ctx.ui.notify(`marked ${entry.firstKey} finished`, "info");
}

/**
 * Tab completion for `/receipt …`. First token: the `done`/`finish` verbs;
 * second token (after `done <prefix>`): open (non-finished) job ids from
 * the ledger. Pure sync reads — never throws; returns [] when no ledger.
 */
export function receiptCompletions(argPrefix: string, cwd: string | undefined): string[] {
  const endsWithSpace = /\s$/.test(argPrefix);
  const all = argPrefix.trim().split(/\s+/).filter(Boolean);
  const partial = endsWithSpace ? "" : (all[all.length - 1] ?? "").toLowerCase();
  const complete = endsWithSpace ? all : all.slice(0, -1);
  if (complete.length === 0) return ["done", "finish"].filter((v) => v.startsWith(partial));
  const verb = (complete[0] ?? "").toLowerCase();
  if ((verb !== "done" && verb !== "finish") || complete.length > 1) return [];
  const text = readLedger(cwd);
  if (text === undefined) return [];
  try {
    return parseReceipt(text)
      .entries.filter((e) => e.table === "job" && !isFinishedState(e.state) && e.firstKey)
      .map((e) => e.firstKey as string)
      .filter((id) => id.toLowerCase().startsWith(partial));
  } catch {
    return [];
  }
}
