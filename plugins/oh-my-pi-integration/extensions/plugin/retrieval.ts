/**
 * Turn-start retrieval: when `PI_INTEGRATION_RETRIEVE=1`, search engram for
 * prior recorded memories for this project before the agent loop starts and
 * inject a bounded context block. Best-effort — never blocks the loop.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { distillQuery, projectKeysFor, sweepRecall } from "../commands/commands/recall";

/** Register the before_agent_start retrieval hook. */
export function registerTurnStartRetrieval(pi: ExtensionAPI): void {
  // ---- 3) turn-start retrieval: surface prior recorded solutions -------
  const RETRIEVE_ON = () =>
    typeof process !== "undefined" && process.env?.PI_INTEGRATION_RETRIEVE === "1";
  const EVERY_TURN = () =>
    typeof process !== "undefined" && process.env?.PI_RETRIEVE_EVERY_TURN === "1";
  const RETRIEVE_TIMEOUT_MS = 2500;
  let retrievedThisSession = false;

  // Injects prior-session context before the agent loop. Best-effort and
  // bounded: a failure/timeout returns undefined so the turn is never blocked.
  pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
    if (!RETRIEVE_ON()) return undefined;
    if (!EVERY_TURN() && retrievedThisSession) return undefined;
    retrievedThisSession = true;

    const keys = projectKeysFor(ctx.cwd);
    const fallback = keys[0] ?? "omp";
    const raw = event.prompt.trim() || fallback;
    const distilled = distillQuery(raw, 4);
    try {
      // sweepRecall: keyword search per key, then recent-context per key.
      const text = await sweepRecall(pi, distilled || raw, keys, RETRIEVE_TIMEOUT_MS);
      if (!text) return undefined;
      return {
        message: {
          customType: "omp-retrieval",
          content:
            "Prior recorded context for this project (from engram) — reuse it when relevant to save time:\n\n" +
            text,
          display: false,
          attribution: "agent",
        },
      };
    } catch {
      /* retrieval must never break the loop */
      return undefined;
    }
  });
}
