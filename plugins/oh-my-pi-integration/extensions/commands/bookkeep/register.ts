/** Wiring for `/bookkeep` onto the plugin factory's `pi`. */

import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { argumentItems } from "../completions";
import { resolveBookkeepAction } from "./actions";
import { bookkeepCompletions } from "./completions";
import { detectBookkeepEnv } from "./env";
import { tryGiwtBookkeep } from "./giwt";

/** Register `/bookkeep` on the plugin factory's `pi`. */
export function registerBookkeep(pi: ExtensionAPI): void {
  pi.registerCommand("bookkeep", {
    description: "Planning hygiene: `/bookkeep <audit|sync|find|issue|list|config> ...`",
    // NOTE: process.cwd() because getArgumentCompletions gets no ctx — assumes TUI cwd == process cwd (see completions.ts).
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(
        argumentPrefix,
        bookkeepCompletions(detectBookkeepEnv(process.cwd()), argumentPrefix),
      ),
    handler: async (args, ctx: ExtensionCommandContext) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const env = detectBookkeepEnv(ctx.cwd);

      if (await tryGiwtBookkeep(pi, ctx, env, argv)) return;

      const action = resolveBookkeepAction(env, argv);
      if ("prompt" in action) {
        await pi.sendUserMessage(action.prompt);
        return;
      }
      ctx.ui.notify(action.message, action.level);
    },
  });
}
