/**
 * Turn-start retrieval: when `PI_INTEGRATION_RETRIEVE=1`, search engram for
 * prior recorded memories for this project before the agent loop starts and
 * inject a bounded context block. Best-effort — never blocks the loop.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  distillQuery,
  formatRetrieval,
  projectFor,
  RETRIEVE_LIMIT,
} from "../commands/commands/recall";

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
    const proj = projectFor(ctx.cwd);
    if (!EVERY_TURN() && retrievedThisSession) return undefined;
    retrievedThisSession = true;

    const raw = event.prompt.trim() || proj;
    const distilled = distillQuery(raw, 4);
    try {
      // 1) Best attempt: keyword search on a distilled query derived from the prompt.
      let res = await pi.exec(
        "engram",
        ["search", distilled || raw, "--project", proj, "--limit", String(RETRIEVE_LIMIT)],
        { timeout: RETRIEVE_TIMEOUT_MS },
      );
      let text = formatRetrieval(res.stdout ?? "");

      // 2) Keyword matching is brittle — if nothing matched, fall back to the
      //    project's recent recorded context so the agent still sees prior work.
      if (!text) {
        res = await pi.exec("engram", ["search", proj, "--project", proj, "--limit", "4"], {
          timeout: RETRIEVE_TIMEOUT_MS,
        });
        text = formatRetrieval(res.stdout ?? "");
      }

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
