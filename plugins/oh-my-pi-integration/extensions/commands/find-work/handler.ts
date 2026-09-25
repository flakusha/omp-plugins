/**
 * `/find-work` handler: parse, fetch, then hand off to the present pipeline.
 * Tab completions and `registerFindWork` wiring live here; the ask-dialog
 * flow, filter/cap/relax helpers, and per-mode renderer live in
 * `./handler-present`.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { argumentItems } from "../completions";
import { fetchTickets } from "./fetch";
import { type AskCapableContext, presentFindWork } from "./handler-present";
import { LIST_SUGAR_SUFFIXES, MODE_KEYWORDS } from "./keywords";
import { parseFindWorkArgs } from "./parse-args";
import { detectWorkSources, findWorkUsage, hasFetchableSource } from "./sources";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Parse, detect sources, fetch best-effort, then present. */
async function runFindWork(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  argv: string[],
): Promise<void> {
  const { args: parsed, error } = parseFindWorkArgs(argv);
  if (error) {
    ctx.ui.notify(error, "error");
    return;
  }
  const root = ctx.cwd;
  const sources = detectWorkSources(root);
  if (argv.length === 0 && !hasFetchableSource(sources)) {
    ctx.ui.notify(findWorkUsage(sources), "info");
    return;
  }
  // Search mode never runs the full repo check — the tool cluster is the
  // slow lane (shared wall budget), so `-s` implies fast; `--fast` forces it.
  const fast = parsed.fast || parsed.search !== undefined;
  if (
    fast &&
    (sources.lint || sources.typecheck || sources.tests || sources.knip || sources.jscpd)
  ) {
    ctx.ui.notify(
      "fast mode: skipping live tool findings (lint/typecheck/tests/knip/jscpd)",
      "info",
    );
  }
  const { tickets, warnings } = await fetchTickets(pi, root, sources, { fast });
  for (const warning of warnings) ctx.ui.notify(warning, "warning");
  await presentFindWork(pi, ctx, root, parsed, tickets);
}

/** `list-*` sugar variants advertised to users (derived from the parser table). */
export const FIND_WORK_SUGAR = LIST_SUGAR_SUFFIXES.map(
  (s) => `list-${s}`,
) as readonly `list-${string}`[];
/** Canonical option-region vocabulary (first token also allows mode words). */
const OPTION_KEYWORDS = [
  ...MODE_KEYWORDS,
  "order",
  "letters",
  "priorities",
  "types",
  "batches",
  "bugs",
  "features",
  "epics",
  "tasks",
  "-s",
  "--search",
  "-m",
  "-d",
  "--directive",
  "--fast",
];

/**
 * Tab completion for `/find-work …`. The option region is enumerable —
 * mode/scheme/grouping/kind keywords plus `list-*` sugar — while the
 * directive is free text. Once the completed tokens form a directive
 * (parse moved into the query region), completion stops.
 */
export function findWorkCompletions(argPrefix: string): string[] {
  const endsWithSpace = /\s$/.test(argPrefix);
  const all = argPrefix.trim().split(/\s+/).filter(Boolean);
  const partial =
    endsWithSpace || all.length === 0 ? "" : (all[all.length - 1] ?? "").toLowerCase();
  const complete = endsWithSpace ? all : all.slice(0, -1);
  const { args, error } = parseFindWorkArgs(complete);
  if (error || args.query) return [];
  const vocab =
    partial === "list" || partial.startsWith("list-")
      ? [...FIND_WORK_SUGAR]
      : complete.length === 0
        ? OPTION_KEYWORDS
        : OPTION_KEYWORDS.filter((word) => !(MODE_KEYWORDS as readonly string[]).includes(word));
  return vocab.filter((word) => word.startsWith(partial));
}

/** Register `/find-work` on the plugin factory's `pi`. */
export function registerFindWork(pi: ExtensionAPI): void {
  pi.registerCommand("find-work", {
    description:
      "Find actionable tickets across trackers: " +
      "/find-work [list|table|ask|orchestrate] [order|letters|priorities|types] [batches] [bugs|features|epics|tasks] " +
      "[-s <search>] [-m|-d <directive>] [--fast] [directive...]",
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(argumentPrefix, findWorkCompletions(argumentPrefix)),
    handler: async (args, ctx) => {
      await runFindWork(pi, ctx as AskCapableContext, args.trim().split(/\s+/).filter(Boolean));
    },
  });
}
