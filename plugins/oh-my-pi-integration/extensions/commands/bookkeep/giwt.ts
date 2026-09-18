/** giwt subprocess delegation for `/bookkeep audit|sync` — fail-open. */

import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import type { BookkeepEnv } from "./env";

/** Timeout for giwt subprocess calls (plan validate, ticket sync). */
const GIWT_EXEC_TIMEOUT_MS = 30_000;

/**
 * Try giwt delegation for audit/sync: giwt's plan validate and ticket sync
 * run via subprocess (pi.exec) — fail-open to prompt-building when giwt is
 * unavailable or errors. Returns true when the request was served.
 */
export async function tryGiwtBookkeep(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  env: BookkeepEnv,
  argv: string[],
): Promise<boolean> {
  if (!env.giwtAvailable) return false;
  const sub = argv[0];
  if (sub === "audit" && argv[1]) {
    const result = await tryGiwtAudit(pi, env.root, argv[1]);
    if (result === null) return false;
    ctx.ui.notify(result, "info");
    return true;
  }
  if (sub === "sync") {
    const result = await tryGiwtSync(pi, env.root, argv.includes("--fix"));
    if (result === null) return false;
    ctx.ui.notify(result, "info");
    return true;
  }
  return false;
}

/**
 * Try giwt's plan validate CLI for audit. Returns formatted output string,
 * or null when giwt is unavailable or errored (caller falls back to prompt).
 */
async function tryGiwtAudit(
  pi: ExtensionAPI,
  _root: string,
  _target: string,
): Promise<string | null> {
  try {
    const res = await pi.exec("giwt", ["plan", "validate"], { timeout: GIWT_EXEC_TIMEOUT_MS });
    const out = (res.stdout ?? "").trim();
    if (!out) return null;
    return `giwt plan validate:\n${out}`;
  } catch {
    return null; // giwt unavailable or errored
  }
}

/**
 * Try giwt's ticket sync CLI. Returns formatted output string,
 * or null when giwt is unavailable or errored (caller falls back to prompt).
 */
async function tryGiwtSync(pi: ExtensionAPI, _root: string, fix: boolean): Promise<string | null> {
  try {
    const args = fix ? ["sync", "--fix"] : ["sync"];
    const res = await pi.exec("giwt", args, { timeout: GIWT_EXEC_TIMEOUT_MS });
    const out = (res.stdout ?? "").trim();
    if (!out) return null;
    const exitOk = (res as { exitCode?: number }).exitCode === 0;
    return `giwt sync ${fix ? "--fix" : ""} (${exitOk ? "in sync" : "issues remain"}):\n${out}`;
  } catch {
    return null; // giwt unavailable or errored
  }
}
