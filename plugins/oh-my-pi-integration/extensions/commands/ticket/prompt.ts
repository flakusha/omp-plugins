/**
 * `/ticket` user-facing text: usage/help output, the no-giwt fallback prompt,
 * and tab-completion candidate generation.
 */

import type { TicketEnv } from "./env";
import { kebabTicketTitle } from "./exec";
import type { ParsedTicket } from "./parse";
import { TICKET_PRIORITIES, TICKET_TYPES } from "./parse";

export function ticketUsage(env: TicketEnv): string {
  const ids = env.existingIds.length > 0 ? env.existingIds.join(", ") : "none";
  return [
    "usage: /ticket <TYPE> <title> [body] [--label X] [--priority <p>] [--epic <name>] [--effort <size>]",
    "       /ticket loose <title> [body] [--label X] [--priority <p>] [--epic <name>] [--effort <size>]",
    "       /ticket list | help",
    `TYPE \u2208 {${TICKET_TYPES.join(", ")}}`,
    `priority \u2208 {${TICKET_PRIORITIES.join(", ")}}`,
    `giwt: ${env.giwtAvailable ? "yes" : "no"}; tickets dir: ${env.ticketsDir}`,
    `existing tickets: ${env.existingIds.length} (${ids})`,
  ].join("\n");
}

/** Build the turn prompt when giwt is unavailable. */
export function buildTicketFallbackPrompt(env: TicketEnv, parsed: ParsedTicket): string {
  const type = parsed.type ?? (parsed.mode === "loose" ? "TASK" : null);
  const kebab = kebabTicketTitle(parsed.title ?? "untitled");
  const stem = `${type ?? "TASK"}-${kebab}`;
  const abs = `${env.ticketsDir}/${stem}.md`;
  const labels = parsed.labels.length > 0 ? parsed.labels.join(", ") : "(none)";
  const priority = parsed.priority ?? "(unset)";
  const epic = parsed.epic ?? "(none)";
  const effort = parsed.effort ?? "(unset)";
  const body = parsed.body || "No description.";
  return [
    `No giwt detected in ${env.root}. Create the ticket file directly:`,
    `1. Write \`${abs}\` with scaffold:`,
    "```",
    `# ${stem}: ${parsed.title ?? "untitled"}`,
    "",
    "**Status:** Not Started",
    `**Labels:** ${labels}`,
    `**Priority:** ${priority}`,
    `**Epic:** ${epic}`,
    `**Effort:** ${effort}`,
    "",
    body,
    "```",
    `2. If file exists already, leave it untouched and report (id: ${stem}, path: ${abs}) without overwriting.`,
    "3. No git-issue creation step (giwt-only feature).",
    "4. Confirm the file path in the response.",
  ].join("\n");
}

/**
 * Tab completion for `/ticket …`. Subcommand tokens → TYPE set + shortcuts;
 * flag tokens → flag hints or value sets (priority values; epic IDs).
 */
export function ticketCompletions(env: TicketEnv, argPrefix: string): string[] {
  const endsWithSpace = /\s$/.test(argPrefix);
  const tokens = argPrefix.trim().split(/\s+/).filter(Boolean);
  const last = (endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "")).toLowerCase();
  if (tokens.length === 0) {
    return [...TICKET_TYPES, "loose", "list", "help"].filter((s) => s.toLowerCase().includes(last));
  }
  const first = tokens[0]?.toLowerCase();
  if (first === "list" || first === "help") return [];
  if (tokens.length === 1 && !endsWithSpace) {
    return [...TICKET_TYPES, "loose", "list", "help"].filter((s) => s.toLowerCase().includes(last));
  }
  if (last.startsWith("--priority")) return [...TICKET_PRIORITIES];
  if (last.startsWith("--epic")) {
    return env.existingIds.filter(
      (id) => id.toLowerCase().includes(last) && id.toLowerCase().includes("epic"),
    );
  }
  return ["--label", "--priority", "--epic", "--effort"].filter((f) => f.includes(last));
}
