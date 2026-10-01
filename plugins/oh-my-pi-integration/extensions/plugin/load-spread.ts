/**
 * 0-shot load-spread classifier.
 *
 * Spreads subagent load across the approved model roster: every `task` spawn
 * whose model came from a role (not an explicit selector) is classified
 * HEAVY/LIGHT by one tiny 0-shot request on the profile's `@smol` role model.
 * LIGHT spawns are rerouted to the light selector (`@smol` by default);
 * HEAVY spawns keep the resolved patterns. Fail-open: any resolution,
 * inference, or parse failure leaves the spawn untouched.
 *
 * 18.4.6's `BeforeSubagentSpawnEvent` carries no assignment text, so the
 * handler stashes `task`-tool input at `tool_call` time and consumes it FIFO
 * at spawn time (per agent name).
 *
 * Config (env):
 *   PI_LOAD_SPREAD_DISABLE=1      opt out entirely
 *   PI_LOAD_SPREAD_CLASSIFIER     classifier selector (default "@smol")
 *   PI_LOAD_SPREAD_LIGHT          light-route selector (default "@smol")
 *   PI_LOAD_SPREAD_TIMEOUT_MS     classifier budget (default 8000)
 *   PI_LOAD_SPREAD_MAX_CHARS      assignment chars fed to the prompt (default 2000)
 */
import { streamSimple } from "@oh-my-pi/pi-ai";
import type {
  BeforeSubagentSpawnEvent,
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@oh-my-pi/pi-coding-agent";

const DISABLE = (): boolean => process.env.PI_LOAD_SPREAD_DISABLE === "1";
const classifierSpec = (): string => process.env.PI_LOAD_SPREAD_CLASSIFIER ?? "@smol";
const lightSpec = (): string => process.env.PI_LOAD_SPREAD_LIGHT ?? "@smol";
const timeoutMs = (): number => Number(process.env.PI_LOAD_SPREAD_TIMEOUT_MS ?? 8000);
const maxChars = (): number => Number(process.env.PI_LOAD_SPREAD_MAX_CHARS ?? 2000);

/** The spawn fields the routing guard and prompt need. */
export interface ClassifiableSpawn {
  agent: string;
  modelRole?: string;
  patterns: string[];
  assignment?: string;
  solutionSpace?: string;
}

/** Bundled default spawn agent — its definition pins no model, so role-derived
 * patterns here mean "inherited the parent's model", which is safe to reroute. */
const MODEL_LESS_AGENTS: ReadonlySet<string> = new Set(["task"]);

/** Task-tool input stashed at `tool_call` time, awaiting its spawn event. */
export interface PendingSpawnText {
  assignment: string;
  solutionSpace?: string;
}

/** FIFO per agent name: parallel spawns dispatch tool_call before spawn. */
const pendingSpawns = new Map<string, PendingSpawnText[]>();

/** Record a `task` tool call's per-task text for the next spawn of each agent. */
export function stashTaskInput(event: ToolCallEvent): void {
  if (event.toolName !== "task") return;
  const input = event.input as Record<string, unknown>;
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  for (const entry of tasks) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const assignment = typeof record.task === "string" ? record.task : "";
    if (assignment.trim().length === 0) continue;
    const agent =
      typeof record.agent === "string" && record.agent.trim().length > 0
        ? record.agent.trim()
        : "task";
    const solutionSpace =
      typeof record.solutionSpace === "string" ? record.solutionSpace : undefined;
    const queue = pendingSpawns.get(agent) ?? [];
    queue.push({ assignment, solutionSpace });
    pendingSpawns.set(agent, queue);
  }
}

/** Consume the next stashed text for this agent, if any. */
export function takePendingText(agent: string): PendingSpawnText | undefined {
  const queue = pendingSpawns.get(agent);
  const text = queue?.shift();
  if (queue && queue.length === 0) pendingSpawns.delete(agent);
  return text;
}

/**
 * Route role-derived spawns with stashed classifiable text: explicit role
 * aliases (`modelRole === "task"`), pattern-less spawns (protocol hosts), and
 * spawns of bundled agents whose frontmatter pins no model (inherited session
 * model). Literal model selectors — agent frontmatter `model: provider/id` —
 * keep their explicit choice (`modelRole` undefined, agent not model-less).
 */
export function shouldRouteSpawn(spawn: ClassifiableSpawn): boolean {
  if (spawn.patterns.length === 0) return true;
  if (spawn.modelRole === "task") return true;
  return MODEL_LESS_AGENTS.has(spawn.agent);
}

/** Parse the classifier's one-word verdict; anything else leaves the spawn alone. */
export function parseVerdict(text: string): "light" | undefined {
  const verdict = text.trim().split(/\s+/)[0]?.toLowerCase();
  return verdict === "light" ? "light" : undefined;
}

/** 0-shot classification prompt: HEAVY or LIGHT, one word, no prose. */
export function buildClassificationPrompt(spawn: ClassifiableSpawn): string {
  const cut = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.length > maxChars() ? `${trimmed.slice(0, maxChars())}…` : trimmed;
  };
  const space = spawn.solutionSpace?.trim();
  return [
    "Classify the following coding-agent subtask.",
    "Answer with exactly one word: HEAVY or LIGHT.",
    "HEAVY: multi-file or multi-step work, new features, refactors, architecture, reviews of large surfaces, debugging with unknown cause.",
    "LIGHT: single-file or single-step work, lookups, renames, small fixes, formatting, mechanical edits, data collection.",
    space ? `Open-endedness hint: ${cut(space)}` : "",
    "",
    "Subtask:",
    cut(spawn.assignment ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Run the 0-shot classifier on the classifier-role model. Returns "light" only
 * on an affirmative verdict; every other outcome (no model, auth, error,
 * HEAVY, garbage) is undefined so the spawn keeps its resolved patterns.
 */
export async function classifySpawn(
  spawn: ClassifiableSpawn,
  ctx: ExtensionContext,
): Promise<"light" | undefined> {
  const model = ctx.models.resolve(classifierSpec());
  if (!model) return undefined;
  const sessionId = ctx.sessionManager.getSessionId();
  const apiKey = ctx.modelRegistry.resolver(model, sessionId);
  const stream = streamSimple(
    model,
    {
      systemPrompt: ["You are a routing classifier. Reply with exactly one word."],
      messages: [
        { role: "user", content: buildClassificationPrompt(spawn), timestamp: Date.now() },
      ],
    },
    { apiKey, signal: AbortSignal.timeout(timeoutMs()), maxTokens: 16 },
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") text += event.delta;
    else if (event.type === "done") {
      text = event.message.content
        .filter((block) => block.type === "text")
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
    } else if (event.type === "error") return undefined;
  }
  return parseVerdict(text);
}

/** Register the `tool_call` stash and `before_subagent_spawn` routing handler. */
export function registerLoadSpread(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: ToolCallEvent) => {
    if (!DISABLE()) stashTaskInput(event);
    return undefined;
  });
  pi.on("before_subagent_spawn", async (event: BeforeSubagentSpawnEvent, ctx: ExtensionContext) => {
    const text = takePendingText(event.agent);
    if (DISABLE() || !text || !shouldRouteSpawn(event)) return undefined;
    try {
      const verdict = await classifySpawn(
        { ...event, assignment: text.assignment, solutionSpace: text.solutionSpace },
        ctx,
      );
      pi.logger.info(`load-spread: agent=${event.agent} verdict=${verdict ?? "none"}`);
      if (verdict !== "light") return undefined;
      return {
        model: lightSpec(),
        note: `load-spread: 0-shot classified light → ${lightSpec()}`,
      };
    } catch (error) {
      pi.logger.warn(`load-spread: classifier failed, spawn unrouted: ${String(error)}`);
      return undefined;
    }
  });
}
