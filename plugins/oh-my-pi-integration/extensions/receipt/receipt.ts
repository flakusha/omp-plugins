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

import { existsSync, readFileSync } from "node:fs";
import type { CustomMessagePayload } from "@oh-my-pi/pi-coding-agent";
import { resolveGiwtConfig } from "../util/giwt-config";
import { formatGiwtLedgerFooter, readGiwtLedger } from "./giwt-bridge";
import { atomicWrite, carry } from "./receipt-carry";
import { type CarryResult, RECEIPT_KEEP, RECEIPT_MAX_LINES } from "./receipt-doc";

export { atomicWrite, carry, setEntryState } from "./receipt-carry";
export type { CarryResult, ReceiptDoc, ReceiptEntry } from "./receipt-doc";
export {
  DEFAULT_STATE,
  parseReceipt,
  RECEIPT_KEEP,
  RECEIPT_MAX_LINES,
  renderFooter,
} from "./receipt-doc";

/** Skip both the TOML read/carry/parse path and the footer build when nothing applies. */
function readAndCarryToml(tomlPath: string): string[] {
  if (!existsSync(tomlPath)) return [];
  let text: string;
  try {
    text = readFileSync(tomlPath, "utf8");
  } catch {
    return [];
  }
  let result: CarryResult;
  try {
    result = carry(text);
  } catch {
    return []; // malformed beyond tolerance: fail open, never write
  }
  // No TOML entries: no carry, no churn — preserve the original guard.
  // giwt ledger is checked below regardless.
  if (result.footer.length <= 1) return [];
  try {
    atomicWrite(tomlPath, result.text);
  } catch {
    /* read-only receipt: still carry the footer this turn */
  }
  return result.footer;
}

/** Build the joined footer string, truncating with a marker when over the line cap. */
function joinFooterLines(lines: string[]): string {
  if (lines.length <= RECEIPT_MAX_LINES) return lines.join("\n");
  return `${lines.slice(0, RECEIPT_MAX_LINES).join("\n")}\n…(truncated)`;
}

/** Build the human-readable "sources" label (e.g. `.omp/receipt.toml + .ledger.jsonl`). */
function buildSourcesLabel(
  tomlPath: string,
  cwd: string,
  tomlFooterLen: number,
  giwtFooterLen: number,
): string {
  const parts: string[] = [];
  if (tomlFooterLen > 0) {
    const label = tomlPath.startsWith(`${cwd}/`) ? tomlPath.slice(cwd.length + 1) : tomlPath;
    parts.push(label);
  }
  if (giwtFooterLen > 0) parts.push(".ledger.jsonl");
  return parts.join(" + ");
}

/** Read giwt's `.ledger.jsonl` if giwt is available; else empty. */
function readGiwtFooter(treeDir: string, available: boolean): string[] {
  if (!available) return [];
  return formatGiwtLedgerFooter(readGiwtLedger(treeDir));
}

/**
 * Carry the project receipt: read the resolved receipt.toml (omp dir from
 * giwt config, default `<cwd>/.omp`), apply chores, write back atomically,
 * and return the footer message injection for `before_agent_start`. Also
 * reads giwt's `.ledger.jsonl` and appends recent agent activity as a
 * secondary section in the footer. Fail-open: any problem → undefined,
 * file untouched (or footer-only when only the write failed).
 */
export async function carryReceipt(
  cwd: string | undefined,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<{ message: CustomMessagePayload } | undefined> {
  if (!cwd || env.PI_RECEIPT_DISABLE === "1") return undefined;

  // ── TOML receipt (job ledger with state) ──────────────────────────
  // omp dir is configurable via giwt.toml/.giwt.toml `paths.omp_dir`.
  const giwtConfig = resolveGiwtConfig(cwd);
  const tomlFooter = readAndCarryToml(giwtConfig.receiptPath);

  // ── giwt ledger (append-only agent activity, read-only) ──────────
  const giwtFooter = readGiwtFooter(giwtConfig.treeDir, giwtConfig.available);

  // ── Combine: TOML jobs first, giwt activity second ────────────────
  const combinedFooter = [...tomlFooter, ...giwtFooter];
  if (combinedFooter.length === 0) return undefined; // nothing to carry

  const footer = joinFooterLines(combinedFooter);
  const sources = buildSourcesLabel(
    giwtConfig.receiptPath,
    cwd,
    tomlFooter.length,
    giwtFooter.length,
  );

  return {
    message: {
      customType: "omp-receipt",
      content:
        `Job receipt (carried from ${sources || "no source"}; update states as work ` +
        `progresses — finished jobs are pruned after ${RECEIPT_KEEP} receipts):\n${footer}`,
      display: false,
      attribution: "agent",
    },
  };
}
