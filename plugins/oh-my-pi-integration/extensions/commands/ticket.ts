/**
 * `/ticket` — planning-ticket dispatcher.
 *
 * Creates a planning ticket via `giwt ticket` when giwt is available,
 * otherwise prompts the user to write the ticket file directly. The
 * handler detects the ticket environment (fs checks, no turn spent)
 * and routes:
 *   - `<TYPE> <title> [body] [--label X] [--priority <p>] [--epic <name>] [--effort <size>]`
 *       strict create via giwt (or prompt fallback)
 *   - `loose <title> [body] [flags]`
 *       ordinary create — type defaults to TASK, full text becomes title + body
 *   - `list` enumerates existing planning-item IDs
 *   - `help` (or empty) answers read-only via `notify`
 *
 * Tab completions surface TYPE tokens, the `loose` / `list` / `help` shortcuts,
 * flag hints, priority values, and any existing epic IDs from `.plan/`.
 *
 * Implementation lives in `./ticket/` (env, parse, exec, prompt); this entry
 * re-exports the full public surface and wires the command handler.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { argumentItems } from "./completions";
import { STATUS_LINE_RE } from "./find-work/keywords";
import { detectTicketEnv } from "./ticket/env";
import { buildTicketExec, parseTicketExec, type TicketExecResult } from "./ticket/exec";
import type { ParsedTicket } from "./ticket/parse";
import { parseTicketArgs, STATUS_VOCAB } from "./ticket/parse";
import { buildTicketFallbackPrompt, ticketCompletions, ticketUsage } from "./ticket/prompt";

export type { TicketEnv } from "./ticket/env";
export { detectTicketEnv } from "./ticket/env";
export type { TicketExecResult } from "./ticket/exec";
export { buildTicketExec, kebabTicketTitle, parseTicketExec } from "./ticket/exec";
export type { ParsedTicket, TicketType } from "./ticket/parse";
export { parseTicketArgs, STATUS_VOCAB, TICKET_PRIORITIES, TICKET_TYPES } from "./ticket/parse";
export { buildTicketFallbackPrompt, ticketCompletions, ticketUsage } from "./ticket/prompt";

/** Extract the best error string from a thrown `pi.exec` failure (stderr > stdout). */
function giwtExecErrorMessage(err: unknown): string {
  const out = (err as { stdout?: unknown; stderr?: unknown }) ?? {};
  if (typeof out.stderr === "string") return out.stderr;
  return typeof out.stdout === "string" ? out.stdout : "";
}

/**
 * Pre-write advisory for the first `**Status:**` line in `body`: null when
 * absent or its (trimmed, case-insensitive) value sits inside the provisional
 * STATUS_VOCAB, else the `[status-vocab advisory]` warning text. Pure —
 * callers notify and proceed (fail-open: the giwt write is never blocked).
 */
export function findStatusAdvisory(body: string | undefined): string | null {
  if (!body) return null;
  for (const line of body.split(/\r?\n/)) {
    const match = STATUS_LINE_RE.exec(line);
    if (!match) continue;
    const value = (match[1] ?? "").trim();
    if ((STATUS_VOCAB as readonly string[]).includes(value.toLowerCase())) return null;
    return `[status-vocab advisory] **Status:** line '${value}' is outside the provisional vocabulary ${STATUS_VOCAB.join(" | ")} — giwt writes the canonical '⬜ Not Started' unless the body overrides it; consider aligning. Proceeding (vocab not yet ratified).`;
  }
  return null;
}

/** Run `giwt ticket` with `parsed`, emitting the pre-write status-vocab advisory (fail-open) and reporting failures on `ctx.ui`. Returns null on any failure. */
async function runGiwtTicket(
  pi: ExtensionAPI,
  parsed: ParsedTicket,
  ctx: ExtensionCommandContext,
): Promise<{ stdout: string; stderr: string; exitCode?: number } | null> {
  const statusAdvisory = findStatusAdvisory(parsed.body);
  if (statusAdvisory) ctx.ui.notify(statusAdvisory, "warning");

  let res: { stdout: string; stderr: string; exitCode?: number };
  try {
    res = await pi.exec("giwt", buildTicketExec(parsed), { timeout: 30_000 });
  } catch (err) {
    ctx.ui.notify(`giwt ticket failed: ${giwtExecErrorMessage(err)}`, "error");
    return null;
  }
  if (res.exitCode !== 0) {
    ctx.ui.notify(
      `giwt ticket failed (exit ${res.exitCode}):\n${res.stderr}${res.stdout}`,
      "error",
    );
    return null;
  }
  return res;
}

/** Format the user-facing summary of a `giwt ticket` execution result. */
function formatTicketSummary(exec: TicketExecResult): string {
  let summary = exec.summary;
  if (exec.file) summary += `\nFile: ${exec.file}`;
  if (exec.issue) summary += `\nIssue: ${exec.issue}`;
  return summary;
}

/** Notify with the existing-ticket listing (count + ids). */
function notifyListMode(
  ctx: ExtensionCommandContext,
  env: { existingIds: readonly string[] },
): void {
  const ids = env.existingIds.length > 0 ? env.existingIds.join(", ") : "none";
  ctx.ui.notify(`existing tickets: ${env.existingIds.length} (${ids})`, "info");
}

/** Register `/ticket` on the plugin factory's `pi`. */
export function registerTicket(pi: ExtensionAPI): void {
  pi.registerCommand("ticket", {
    description:
      "Create a planning ticket via giwt: /ticket <TYPE> <title> [body] [flags] | loose <title> | list | help",
    // NOTE: process.cwd() because getArgumentCompletions gets no ctx — assumes TUI cwd == process cwd (see completions.ts).
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(
        argumentPrefix,
        ticketCompletions(detectTicketEnv(process.cwd()), argumentPrefix),
      ),
    handler: async (args, ctx: ExtensionCommandContext) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const env = detectTicketEnv(ctx.cwd);

      if (argv.length === 0) {
        ctx.ui.notify(ticketUsage(env), "info");
        return;
      }

      const parsed = parseTicketArgs(argv);
      if (parsed.error) {
        ctx.ui.notify(`${parsed.error}\n${ticketUsage(env)}`, "error");
        return;
      }
      if (parsed.mode === "help") {
        ctx.ui.notify(ticketUsage(env), "info");
        return;
      }
      if (parsed.mode === "list") {
        notifyListMode(ctx, env);
        return;
      }
      if (!parsed.title) {
        ctx.ui.notify(`${ticketUsage(env)}\nerror: missing title`, "error");
        return;
      }

      if (!env.giwtAvailable) {
        await pi.sendUserMessage(buildTicketFallbackPrompt(env, parsed));
        return;
      }

      const res = await runGiwtTicket(pi, parsed, ctx);
      if (!res) return;
      ctx.ui.notify(formatTicketSummary(parseTicketExec(res)), "info");
    },
  });
}
