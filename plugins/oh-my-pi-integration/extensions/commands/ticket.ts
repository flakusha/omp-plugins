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
import { detectTicketEnv } from "./ticket/env";
import { buildTicketExec, parseTicketExec } from "./ticket/exec";
import { parseTicketArgs } from "./ticket/parse";
import { buildTicketFallbackPrompt, ticketCompletions, ticketUsage } from "./ticket/prompt";

export type { TicketEnv } from "./ticket/env";
export { detectTicketEnv } from "./ticket/env";
export type { TicketExecResult } from "./ticket/exec";
export { buildTicketExec, kebabTicketTitle, parseTicketExec } from "./ticket/exec";
export type { ParsedTicket, TicketType } from "./ticket/parse";
export { parseTicketArgs, TICKET_PRIORITIES, TICKET_TYPES } from "./ticket/parse";
export { buildTicketFallbackPrompt, ticketCompletions, ticketUsage } from "./ticket/prompt";

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
        const ids = env.existingIds.length > 0 ? env.existingIds.join(", ") : "none";
        ctx.ui.notify(`existing tickets: ${env.existingIds.length} (${ids})`, "info");
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

      let res: { stdout: string; stderr: string; exitCode?: number };
      try {
        res = await pi.exec("giwt", buildTicketExec(parsed), { timeout: 30_000 });
      } catch (err) {
        const out = (err as { stdout?: unknown; stderr?: unknown }) ?? {};
        ctx.ui.notify(
          `giwt ticket failed: ${typeof out.stderr === "string" ? out.stderr : ((out.stdout as string | undefined) ?? "")}`,
          "error",
        );
        return;
      }
      if (res.exitCode !== 0) {
        ctx.ui.notify(
          `giwt ticket failed (exit ${res.exitCode}):\n${res.stderr}${res.stdout}`,
          "error",
        );
        return;
      }
      const parsedExec = parseTicketExec(res);
      let summary = parsedExec.summary;
      if (parsedExec.file) summary += `\nFile: ${parsedExec.file}`;
      if (parsedExec.issue) summary += `\nIssue: ${parsedExec.issue}`;
      ctx.ui.notify(summary, "info");
    },
  });
}
