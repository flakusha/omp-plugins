/**
 * Engram recall primitives: project naming, query distillation, and bounded
 * search formatting. Shared by the `/recall` command (see ../commands.ts) and
 * the turn-start retrieval hook (see ../../plugin/retrieval.ts).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { findGitRoot, primaryRepoRoot } from "../../util/worktree-base";

export function projectFor(cwd: string | undefined): string {
  if (!cwd) return "omp";
  // Canonical key: primary repo name, so worktrees share the origin's
  // memories instead of fragmenting per worktree dir name. Fail-open to
  // the leaf basename when git metadata is unavailable.
  try {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      const primary = primaryRepoRoot(gitRoot);
      const base = primary?.split("/").filter(Boolean).pop();
      if (base) return base;
    }
  } catch {
    /* fall through to basename */
  }
  return cwd.split("/").filter(Boolean).pop() || "omp";
}

/**
 * Compat-fallback keys for reads: canonical first, then the leaf basename
 * when it differs (memories saved before canonicalization, or by tools
 * using the raw dir name, e.g. worktree `<name>` vs primary repo).
 * Saves always use `projectFor` (keys[0]); sweeps read through the list.
 */
export function projectKeysFor(cwd: string | undefined): string[] {
  const canonical = projectFor(cwd);
  if (!cwd) return [canonical];
  const leaf = cwd.split("/").filter(Boolean).pop() || "omp";
  return leaf && leaf !== canonical ? [canonical, leaf] : [canonical];
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

/**
 * Sweep reads through compat keys: keyword search per key, then
 * recent-context fallback per key. First hit wins; null when all empty.
 * Throws on exec failure so callers can warn.
 */
export async function sweepRecall(
  pi: ExtensionAPI,
  query: string,
  keys: string[],
  timeout: number,
): Promise<string | null> {
  for (const proj of keys) {
    const res = await pi.exec(
      "engram",
      ["search", query, "--project", proj, "--limit", String(RETRIEVE_LIMIT)],
      { timeout },
    );
    const text = formatRetrieval(res.stdout ?? "");
    if (text) return text;
  }
  for (const proj of keys) {
    const res = await pi.exec("engram", ["search", proj, "--project", proj, "--limit", "4"], {
      timeout,
    });
    const text = formatRetrieval(res.stdout ?? "");
    if (text) return text;
  }
  return null;
}

/** Single-key recall (compat wrapper over the key sweep). */
export async function runRecall(
  pi: ExtensionAPI,
  query: string,
  proj: string,
): Promise<string | null> {
  return sweepRecall(pi, query, [proj], RECALL_TIMEOUT_MS);
}

export async function recallMemories(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const raw = args.trim();
  if (!raw) {
    ctx.ui.notify("usage: /recall <keywords>", "error");
    return;
  }
  const keys = projectKeysFor(ctx.cwd);
  const query = distillQuery(raw, 4) || raw;
  let text: string | null;
  try {
    text = await sweepRecall(pi, query, keys, RECALL_TIMEOUT_MS);
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
