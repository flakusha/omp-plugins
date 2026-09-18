/**
 * `/ticket` giwt subprocess bridge: argv construction for `giwt ticket` and
 * parsing of its stdout/stderr/exitCode into a summary result.
 */

import type { ParsedTicket } from "./parse";

/** Convert a title to the kebab-case filename stem used by giwt. */
export function kebabTicketTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build the argv for `giwt ticket` from a parsed ticket. */
export function buildTicketExec(parsed: ParsedTicket): string[] {
  const argv: string[] = ["ticket"];
  const type = parsed.type ?? (parsed.mode === "loose" ? "TASK" : null);
  if (type === null) return argv;
  argv.push(type);
  if (parsed.title) argv.push(parsed.title);
  if (parsed.body) argv.push(parsed.body);
  for (const label of parsed.labels) argv.push("--label", label);
  if (parsed.priority) argv.push("--priority", parsed.priority);
  if (parsed.epic) argv.push("--epic", parsed.epic);
  if (parsed.effort) argv.push("--effort", parsed.effort);
  return argv;
}

export interface TicketExecResult {
  ok: boolean;
  summary: string;
  file?: string;
  issue?: string;
  error?: string;
}

/** Parse the stdout/stderr/exitCode of a `giwt ticket` invocation. */
export function parseTicketExec(res: {
  stdout: string;
  stderr: string;
  exitCode?: number;
}): TicketExecResult {
  if (res.exitCode === 0) {
    const file = res.stdout.match(/^File:\s*(.+)$/m)?.[1]?.trim();
    const issue = res.stdout.match(/^Issue:\s*([0-9a-f]{7,40})\s*$/m)?.[1]?.trim();
    return { ok: true, summary: res.stdout.trim(), file, issue };
  }
  const errMsg = res.stderr.trim() || res.stdout.trim();
  return { ok: false, summary: `${res.stdout}${res.stderr}`.trim(), error: errMsg };
}
