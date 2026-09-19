/**
 * `/find-work` handler: ask-dialog flow, present/fetch pipeline, tab
 * completions, and `registerFindWork` wiring.
 */

import type {
  ExtensionAPI,
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import { argumentItems } from "../completions";
import { fetchTickets } from "./fetch";
import {
  ASK_DIALOG_TIMEOUT_MS,
  LIST_SUGAR_SUFFIXES,
  MAX_TICKETS,
  MODE_KEYWORDS,
} from "./keywords";
import { parseFindWorkArgs } from "./parse-args";
import {
  buildChatPrompt,
  buildFindWorkAgentPrompt,
  buildOrchestratePrompt,
  buildSelectedPrompt,
  filterTickets,
} from "./prompts";
import {
  buildAskQuestions,
  buildLabelIndex,
  labelTickets,
  renderList,
  renderTable,
} from "./render";
import { detectWorkSources, findWorkUsage, hasFetchableSource } from "./sources";
import type { FindWorkArgs, LabeledTicket, WorkSources, WorkTicket } from "./types";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface AskCapableContext extends ExtensionCommandContext {
  ui: ExtensionCommandContext["ui"] & {
    askDialog?: (
      questions: ExtensionAskDialogQuestion[],
      dialogOptions?: { timeout?: number },
    ) => Promise<ExtensionAskDialogResult | undefined>;
  };
}

async function runAsk(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  root: string,
  sources: WorkSources,
  labeled: LabeledTicket[],
  args: FindWorkArgs,
): Promise<void> {
  if (typeof ctx.ui.askDialog === "function") {
    const index = buildLabelIndex(labeled);
    const result = await ctx.ui.askDialog(buildAskQuestions(labeled), {
      timeout: ASK_DIALOG_TIMEOUT_MS,
    });
    if (result === undefined) {
      ctx.ui.notify("find-work: cancelled", "info");
      return;
    }
    if (result.kind === "chat") {
      await pi.sendUserMessage(buildChatPrompt(labeled, args.query));
      return;
    }
    const selected = result.results
      .flatMap((r) => r.selectedOptions)
      .map((label) => index.get(label))
      .filter((t): t is WorkTicket => t !== undefined);
    if (selected.length === 0) {
      ctx.ui.notify("find-work: no tickets selected", "info");
      return;
    }
    await pi.sendUserMessage(buildSelectedPrompt(selected, args.query));
    return;
  }
  // No interactive ask surface (print/RPC mode, or dialogs unsupported):
  // let the turn search and present via the agent-side ask tool instead.
  await pi.sendUserMessage(buildFindWorkAgentPrompt(root, sources, args.query));
}

/** Fetch, filter, and present — everything after argument parsing. */
async function presentFindWork(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  root: string,
  parsed: FindWorkArgs,
  tickets: WorkTicket[],
): Promise<void> {
  const sources = detectWorkSources(root);
  let filtered = filterTickets(tickets, parsed);
  if (parsed.mode === "ask" && parsed.query && filtered.length === 0) {
    // The directive has no lexical overlap with the roster (e.g. prose like
    // "propose fixes"): keep the dialog, but say so instead of silently
    // presenting unrelated priority-order tickets as topic candidates.
    ctx.ui.notify(`no open items match '${parsed.query}' — showing unfiltered`, "info");
    filtered = filterTickets(tickets, { ...parsed, query: "" });
  }
  if (filtered.length === 0) {
    // Ask mode with nothing fetched still serves the user: sources the
    // handler cannot exec (jira, glab, tracker CLI) are resolved by the
    // agent turn instead of dead-ending on a miss notice.
    if (parsed.mode === "ask") {
      await pi.sendUserMessage(buildFindWorkAgentPrompt(root, sources, parsed.query));
      return;
    }
    const suffix = parsed.query ? ` matching '${parsed.query}'` : "";
    ctx.ui.notify(`no open work items found${suffix}`, "info");
    return;
  }
  if (filtered.length > MAX_TICKETS) {
    ctx.ui.notify(`showing first ${MAX_TICKETS} of ${filtered.length} matching items`, "warning");
    filtered = filtered.slice(0, MAX_TICKETS);
  }
  const labeled = labelTickets(filtered, parsed.scheme);
  if (parsed.mode === "ask") {
    await runAsk(pi, ctx, root, sources, labeled, parsed);
    return;
  }
  if (parsed.mode === "orchestrate") {
    await pi.sendUserMessage(buildOrchestratePrompt(labeled, sources, parsed.query));
    return;
  }
  ctx.ui.notify(
    parsed.mode === "table"
      ? renderTable(labeled, parsed.batches)
      : renderList(labeled, parsed.batches),
    "info",
  );
}

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
  const { tickets, warnings } = await fetchTickets(pi, root, sources);
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
      "/find-work [list|table|ask|orchestrate] [order|letters|priorities|types] [batches] [bugs|features|epics|tasks] [directive...]",
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(argumentPrefix, findWorkCompletions(argumentPrefix)),
    handler: async (args, ctx) => {
      await runFindWork(pi, ctx as AskCapableContext, args.trim().split(/\s+/).filter(Boolean));
    },
  });
}
