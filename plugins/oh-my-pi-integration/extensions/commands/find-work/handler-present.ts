/**
 * `/find-work` present pipeline: ask-dialog flow, filter+cap+relax helpers,
 * and the per-mode renderer. Pure orchestration — no parse, no register.
 */

import type {
  ExtensionAPI,
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import { ASK_DIALOG_TIMEOUT_MS, MAX_TICKETS } from "./keywords";
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
import { searchTickets } from "./search";
import { detectWorkSources } from "./sources";
import type { FindWorkArgs, LabeledTicket, WorkSources, WorkTicket } from "./types";

export interface AskCapableContext extends ExtensionCommandContext {
  ui: ExtensionCommandContext["ui"] & {
    askDialog?: (
      questions: ExtensionAskDialogQuestion[],
      dialogOptions?: { timeout?: number },
    ) => Promise<ExtensionAskDialogResult | undefined>;
  };
}

export async function runAsk(
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
      await pi.sendUserMessage(buildChatPrompt(labeled, args.directive ?? args.query, args.search));
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
    await pi.sendUserMessage(
      buildSelectedPrompt(selected, args.directive ?? args.query, args.search),
    );
    return;
  }
  await pi.sendUserMessage(
    buildFindWorkAgentPrompt(root, sources, args.directive ?? args.query, args.search),
  );
}

function mergeSearchHits(
  filtered: WorkTicket[],
  tickets: WorkTicket[],
  root: string,
  search: string | undefined,
): WorkTicket[] {
  if (!search) return filtered;
  const shown = new Set(filtered.map((t) => t.id));
  const hits = searchTickets(tickets, root, search).filter((h) => !shown.has(h.ticket.id));
  if (hits.length === 0) return filtered;
  return [...filtered, ...hits.map((h) => ({ ...h.ticket, matchedVia: h.via }))];
}

function capRoster(filtered: WorkTicket[], ctx: AskCapableContext): WorkTicket[] {
  if (filtered.length <= MAX_TICKETS) return filtered;
  ctx.ui.notify(`showing first ${MAX_TICKETS} of ${filtered.length} matching items`, "warning");
  return filtered.slice(0, MAX_TICKETS);
}

function relaxForAsk(
  tickets: WorkTicket[],
  parsed: FindWorkArgs,
  filtered: WorkTicket[],
  ctx: AskCapableContext,
): WorkTicket[] {
  if (parsed.mode !== "ask" || !parsed.query || filtered.length > 0) return filtered;
  ctx.ui.notify(`no open items match '${parsed.query}' — showing unfiltered`, "info");
  return filterTickets(tickets, { ...parsed, query: "" });
}

async function renderMode(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  root: string,
  sources: WorkSources,
  labeled: LabeledTicket[],
  parsed: FindWorkArgs,
): Promise<void> {
  const directive = parsed.directive ?? parsed.query;
  if (parsed.mode === "ask") {
    await runAsk(pi, ctx, root, sources, labeled, parsed);
    return;
  }
  if (parsed.mode === "orchestrate") {
    await pi.sendUserMessage(buildOrchestratePrompt(labeled, sources, directive, parsed.search));
    return;
  }
  ctx.ui.notify(
    parsed.mode === "table"
      ? renderTable(labeled, parsed.batches)
      : renderList(labeled, parsed.batches),
    "info",
  );
}

export async function presentFindWork(
  pi: ExtensionAPI,
  ctx: AskCapableContext,
  root: string,
  parsed: FindWorkArgs,
  tickets: WorkTicket[],
): Promise<void> {
  const sources = detectWorkSources(root);
  let filtered = relaxForAsk(tickets, parsed, filterTickets(tickets, parsed), ctx);
  filtered = capRoster(filtered, ctx);
  const combined = mergeSearchHits(filtered, tickets, root, parsed.search);
  if (combined.length === 0) {
    if (parsed.mode === "ask") {
      await pi.sendUserMessage(
        buildFindWorkAgentPrompt(root, sources, parsed.directive ?? parsed.query, parsed.search),
      );
      return;
    }
    const suffix = parsed.query ? ` matching '${parsed.query}'` : "";
    ctx.ui.notify(`no open work items found${suffix}`, "info");
    return;
  }
  const labeled = labelTickets(combined, parsed.scheme);
  await renderMode(pi, ctx, root, sources, labeled, parsed);
}
