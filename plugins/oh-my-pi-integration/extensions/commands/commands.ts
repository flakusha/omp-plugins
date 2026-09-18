/**
 * Global slash commands for the oh-my-pi-integration plugin (`/receipt`,
 * `/verify`, `/recall`, `/find-work`, `/finalize`, `/bookkeep`, `/worktree`, `/wt`).
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
 *
 * Recall primitives live in ./commands/recall; `/receipt` internals in
 * ./commands/receipt-cmd. This entry re-exports their public surface and
 * wires the registrations.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerBookkeep } from "./bookkeep";
import { recallMemories } from "./commands/recall";
import { finishReceiptJob, receiptCompletions, showReceipt } from "./commands/receipt-cmd";
import { argumentItems } from "./completions";
import { registerFinalize } from "./finalize";
import { registerFindWork } from "./find-work";
import { registerWorktree } from "./worktree";
import { registerWt } from "./wt";

export {
  distillQuery,
  formatRetrieval,
  projectFor,
  RETRIEVE_LIMIT,
  RETRIEVE_MAX_CHARS,
  runRecall,
  STOPWORDS,
} from "./commands/recall";
export {
  finishReceiptJob,
  receiptCompletions,
  renderReceiptStatus,
  showReceipt,
} from "./commands/receipt-cmd";

/** Build the turn prompt for `/verify`; trailing user args become extra focus. */
export function buildVerifyPrompt(extra: string): string {
  const base =
    "Run this project's verification gate (e.g. `bun run verify`, or the closest " +
    "lint + typecheck + test pipeline this repo defines) and report pass/fail per " +
    "step, with the failing output for anything red.";
  return extra ? `${base}\n\nExtra focus from the user: ${extra}` : base;
}

/** Register `/receipt`, `/verify`, `/recall`, `/find-work`, `/finalize`, `/bookkeep`, `/worktree`, `/wt` on the plugin factory's `pi`. */
export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("receipt", {
    description: "Show the project job ledger; `/receipt done <id>` marks a job finished",
    // NOTE: process.cwd() because getArgumentCompletions gets no ctx — assumes TUI cwd == process cwd (see completions.ts).
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(argumentPrefix, receiptCompletions(argumentPrefix, process.cwd())),
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

  registerFindWork(pi);
  registerFinalize(pi);
  registerBookkeep(pi);
  registerWorktree(pi);
  registerWt(pi);
}
