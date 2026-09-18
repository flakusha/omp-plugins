/**
 * `/ticket` argument model and parsing: ticket types/priorities, the
 * `ParsedTicket` shape, and the pure argv → ParsedTicket parser (strict TYPE
 * form, `loose`, `list`, `help`).
 */

export type TicketType = "BUG" | "FEAT" | "FIX" | "IDEA" | "TASK" | "SOL" | "INFRA";
export const TICKET_TYPES: readonly TicketType[] = [
  "BUG",
  "FEAT",
  "FIX",
  "IDEA",
  "TASK",
  "SOL",
  "INFRA",
] as const;
export const TICKET_PRIORITIES: readonly string[] = ["low", "medium", "high", "critical"] as const;

export interface ParsedTicket {
  type: TicketType | null;
  mode: "strict" | "loose" | "list" | "help";
  title: string | null;
  body: string;
  labels: string[];
  priority?: string;
  epic?: string;
  effort?: string;
  error?: string;
}

interface FlagResult {
  title: string | null;
  body: string;
  labels: string[];
  priority?: string;
  epic?: string;
  effort?: string;
  error?: string;
}

const FLAGS_WITH_VALUE = ["--label", "--priority", "--epic", "--effort"] as const;
type FlagWithValue = (typeof FLAGS_WITH_VALUE)[number];

function isFlagWithValue(token: string): token is FlagWithValue {
  return (FLAGS_WITH_VALUE as readonly string[]).includes(token);
}

function isTicketType(value: string): value is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(value);
}

function isPriority(value: string): boolean {
  return (TICKET_PRIORITIES as readonly string[]).includes(value);
}

/** Pure parser for positional title/body + flag pairs. */
function parseFlags(args: string[]): FlagResult {
  const labels: string[] = [];
  let title: string | null = null;
  let titleSeen = false;
  const bodyParts: string[] = [];
  let priority: string | undefined;
  let epic: string | undefined;
  let effort: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === undefined) break;
    if (isFlagWithValue(token)) {
      const next = args[i + 1];
      if (next === undefined) {
        return { title: null, body: "", labels, error: `${token} requires a value` };
      }
      if (token === "--priority" && !isPriority(next)) {
        return {
          title: null,
          body: "",
          labels,
          error: `invalid priority '${next}'. Expected one of ${TICKET_PRIORITIES.join(", ")}`,
        };
      }
      switch (token) {
        case "--label":
          labels.push(next);
          break;
        case "--priority":
          priority = next;
          break;
        case "--epic":
          epic = next;
          break;
        case "--effort":
          effort = next;
          break;
      }
      i++;
      continue;
    }
    if (!titleSeen) {
      title = token;
      titleSeen = true;
    } else {
      bodyParts.push(token);
    }
  }
  return { title, body: bodyParts.join(" "), labels, priority, epic, effort };
}

/** Parse `argv` (no leading command token) into a `ParsedTicket`. */
export function parseTicketArgs(argv: string[]): ParsedTicket {
  const base: ParsedTicket = { type: null, mode: "strict", title: null, body: "", labels: [] };
  if (argv.length === 0 || argv[0] === "help") return { ...base, mode: "help" };
  if (argv[0] === "list") return { ...base, mode: "list" };
  if (argv[0] === "loose") {
    const rest = argv.slice(1);
    if (rest.length === 0) return { ...base, mode: "loose", error: "loose requires a title" };
    const parsed = parseFlags(rest);
    if (parsed.error) return { ...base, mode: "loose", error: parsed.error };
    return {
      ...base,
      mode: "loose",
      title: parsed.title,
      body: parsed.body,
      labels: parsed.labels,
      priority: parsed.priority,
      epic: parsed.epic,
      effort: parsed.effort,
    };
  }
  const candidate = (argv[0] ?? "").toUpperCase();
  if (!isTicketType(candidate)) {
    return {
      ...base,
      error: `unknown ticket type '${argv[0]}'. Expected one of ${TICKET_TYPES.join(", ")}`,
    };
  }
  const rest = argv.slice(1);
  const parsed = parseFlags(rest);
  if (parsed.error) return { ...base, type: candidate, error: parsed.error };
  return {
    ...base,
    type: candidate,
    title: parsed.title,
    body: parsed.body,
    labels: parsed.labels,
    priority: parsed.priority,
    epic: parsed.epic,
    effort: parsed.effort,
  };
}
