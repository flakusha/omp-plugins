/**
 * Global slash commands for the oh-my-pi-integration plugin (`/receipt`,
 * `/verify`, `/recall`, `/finalize`, `/bookkeep`, `/worktree`).
 *
 * Registered from the plugin factory (see index.ts), so they ship with the
 * extension payload and resolve in the default agent and every profile.
 * Same kill-switch as the rest of the plugin: `PI_INTEGRATION_DISABLE=1`.
 *
 * Handler discipline (command handlers receive args + ctx, no AgentAPI):
 * - read-only answers go straight to the user via `ctx.ui.notify`
 *   (no agent turn spent);
 * - doing-things go through `pi.sendUserMessage`, which starts a turn with
 *   the built prompt;
 * - local subprocesses go through `pi.exec` (engram CLI, git reads and
 *   worktree creation), best-effort with a user-visible warning on failure
 *   — commands never break the loop, and never merge or delete branches.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
  atomicWrite,
  DEFAULT_STATE,
  parseReceipt,
  RECEIPT_MAX_LINES,
  renderFooter,
  setEntryState,
} from "../receipt/receipt";
import { registerBookkeep } from "./bookkeep";
import { registerFinalize } from "./finalize";
import { registerWorktree } from "./worktree";

export function projectFor(cwd: string | undefined): string {
  if (!cwd) return "omp";
  return cwd.split("/").filter(Boolean).pop() || "omp";
}

// Function words that add no search signal (static membership table).
export const STOPWORDS: Record<string, true> = {
  the: true,
  a: true,
  an: true,
  is: true,
  are: true,
  was: true,
  were: true,
  be: true,
  been: true,
  being: true,
  to: true,
  of: true,
  in: true,
  on: true,
  for: true,
  and: true,
  or: true,
  but: true,
  not: true,
  no: true,
  you: true,
  your: true,
  we: true,
  our: true,
  i: true,
  it: true,
  its: true,
  this: true,
  that: true,
  with: true,
  as: true,
  at: true,
  by: true,
  from: true,
  they: true,
  them: true,
  he: true,
  she: true,
  their: true,
  there: true,
  these: true,
  those: true,
  what: true,
  when: true,
  where: true,
  why: true,
  how: true,
  do: true,
  does: true,
  did: true,
  done: true,
  would: true,
  could: true,
  should: true,
  can: true,
  will: true,
  may: true,
  might: true,
  just: true,
  also: true,
  more: true,
  most: true,
  about: true,
  into: true,
  over: true,
  under: true,
  again: true,
  // biome-ignore lint/suspicious/noThenProperty: keyword stopword; table is only index-accessed, never awaited.
  then: true,
  than: true,
  so: true,
  if: true,
  which: true,
  who: true,
  whom: true,
};

/**
 * Distill a prompt into a short keyword query (≤N significant tokens). The
 * engram CLI search is keyword-sensitive — a verbose prompt matches nothing
 * while a couple of key terms do — so keep only meaningful content words.
 */
export function distillQuery(prompt: string, max: number): string {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of prompt.toLowerCase().split(/[^a-z0-9]+/)) {
    const t = raw.trim();
    if (t.length < 3) continue;
    if (STOPWORDS[t]) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
    if (tokens.length >= max) break;
  }
  return tokens.join(" ");
}

export const RETRIEVE_LIMIT = 6; // max memories per search
export const RETRIEVE_MAX_CHARS = 1800; // hard cap on surfaced memory text

/** Foreground user-invoked search may wait longer than background retrieval. */
const RECALL_TIMEOUT_MS = 10_000;

/**
 * Compact engram search output into short, human-readable text.
 * Returns the text to surface, or null when nothing useful was found.
 */
export function formatRetrieval(stdout: string): string | null {
  const lines: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^\s*(?:Found|no memories found|wall time|session\s*completed\.?)/i.test(line))
      continue;
    // Match the engram CLI block header: "[1] #611 (session_summary) — title"
    if (/^\[\d+\]\s+#\d+/.test(line)) {
      const m = line.match(/—\s*(.*)$/);
      lines.push(m?.[1] ?? line);
      continue;
    }
    lines.push(line);
  }
  if (lines.length === 0) return null;
  let joined = lines.join("\n").trim();
  if (joined.length > RETRIEVE_MAX_CHARS)
    joined = `${joined.slice(0, RETRIEVE_MAX_CHARS)}\n…(truncated)`;
  return joined;
}

/** Render the ledger status for `/receipt` (no args): footer lines, bounded. */
export function renderReceiptStatus(text: string): string[] {
  const footer = renderFooter(parseReceipt(text));
  if (footer.length > RECEIPT_MAX_LINES) {
    return [...footer.slice(0, RECEIPT_MAX_LINES), "…(truncated)"];
  }
  return footer;
}

/** Build the turn prompt for `/verify`; trailing user args become extra focus. */
export function buildVerifyPrompt(extra: string): string {
  const base =
    "Run this project's verification gate (e.g. `bun run verify`, or the closest " +
    "lint + typecheck + test pipeline this repo defines) and report pass/fail per " +
    "step, with the failing output for anything red.";
  return extra ? `${base}\n\nExtra focus from the user: ${extra}` : base;
}

/**
 * Search engram for a distilled query, falling back to the project's recent
 * context when keyword matching finds nothing (same two-step as turn-start
 * retrieval). Returns null when both come back empty; exec failures throw
 * to the caller, which surfaces a warning.
 */
export async function runRecall(
  pi: ExtensionAPI,
  query: string,
  proj: string,
): Promise<string | null> {
  let res = await pi.exec(
    "engram",
    ["search", query, "--project", proj, "--limit", String(RETRIEVE_LIMIT)],
    { timeout: RECALL_TIMEOUT_MS },
  );
  let text = formatRetrieval(res.stdout ?? "");
  if (!text) {
    res = await pi.exec("engram", ["search", proj, "--project", proj, "--limit", "4"], {
      timeout: RECALL_TIMEOUT_MS,
    });
    text = formatRetrieval(res.stdout ?? "");
  }
  return text;
}

function receiptPath(cwd: string | undefined): string | undefined {
  return cwd ? join(cwd, ".omp", "receipt.toml") : undefined;
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

async function showReceipt(ctx: ExtensionCommandContext): Promise<void> {
  const text = readLedger(ctx.cwd);
  if (text === undefined) {
    ctx.ui.notify("no job ledger yet (nothing recorded in .omp/receipt.toml)", "info");
    return;
  }
  const footer = renderReceiptStatus(text);
  if (footer.length <= 1) {
    ctx.ui.notify("job ledger is empty", "info");
    return;
  }
  ctx.ui.notify(footer.join("\n"), "info");
}

async function finishReceiptJob(id: string, ctx: ExtensionCommandContext): Promise<void> {
  const path = receiptPath(ctx.cwd);
  const text = readLedger(ctx.cwd);
  if (!path || text === undefined) {
    ctx.ui.notify("no job ledger to update (.omp/receipt.toml not found)", "error");
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

async function recallMemories(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const raw = args.trim();
  if (!raw) {
    ctx.ui.notify("usage: /recall <keywords>", "error");
    return;
  }
  const proj = projectFor(ctx.cwd);
  const query = distillQuery(raw, 4) || raw;
  let text: string | null;
  try {
    text = await runRecall(pi, query, proj);
  } catch {
    ctx.ui.notify("memory search failed (engram unavailable?)", "warning");
    return;
  }
  if (!text) {
    ctx.ui.notify(`no recorded memories match '${raw}'`, "info");
    return;
  }
  ctx.ui.notify(`recorded context for '${raw}':\n${text}`, "info");
}

/** Register `/receipt`, `/verify`, `/recall`, `/finalize`, `/bookkeep` on the plugin factory's `pi`. */
export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("receipt", {
    description: "Show the project job ledger; `/receipt done <id>` marks a job finished",
    handler: async (args, ctx) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      if (argv[0] === "done" || argv[0] === "finish") {
        if (!argv[1]) {
          ctx.ui.notify("usage: /receipt done <id>", "error");
          return;
        }
        await finishReceiptJob(argv[1], ctx);
        return;
      }
      if (argv.length > 0) {
        ctx.ui.notify("usage: /receipt [done <id>]", "error");
        return;
      }
      await showReceipt(ctx);
    },
  });

  pi.registerCommand("verify", {
    description: "Run this project's verification gate and report results",
    handler: async (args) => {
      await pi.sendUserMessage(buildVerifyPrompt(args.trim()));
    },
  });

  pi.registerCommand("recall", {
    description: "Search recorded engram memories: `/recall <keywords>`",
    handler: async (args, ctx) => {
      await recallMemories(args, pi, ctx);
    },
  });

  registerFinalize(pi);
  registerBookkeep(pi);
  registerWorktree(pi);
}
