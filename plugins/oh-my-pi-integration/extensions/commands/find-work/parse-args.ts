/**
 * `/find-work` argument parsing: the mode keyword counts only as the FIRST
 * token; scheme/group/filter keywords are consumed until the first free-text
 * token, which starts the directive.
 */

import {
  GROUP_KEYWORDS,
  KIND_KEYWORDS,
  LIST_SUGAR_RE,
  MODE_KEYWORDS,
  SCHEME_KEYWORDS,
} from "./keywords";
import type { FindWorkArgs, WorkMode } from "./types";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function normToken(token: string): string {
  return token.replace(/^--/, "").toLowerCase();
}

function applyKeyword(word: string, args: FindWorkArgs, modeExplicit: boolean): boolean {
  const scheme = SCHEME_KEYWORDS[word];
  if (scheme) {
    args.scheme = scheme;
    return true;
  }
  if ((GROUP_KEYWORDS as readonly string[]).includes(word)) {
    args.batches = true;
    return true;
  }
  const kind = KIND_KEYWORDS[word];
  if (kind) {
    if (!args.kinds.includes(kind)) args.kinds.push(kind);
    return true;
  }
  const sugar = LIST_SUGAR_RE.exec(word);
  if (sugar?.[1]) {
    if (!modeExplicit) args.mode = "list";
    return applyKeyword(sugar[1], args, true);
  }
  return false;
}

/** Usage error for a typo'd `list-*` variant. */
function unknownListSugar(rest: string): string {
  return (
    `unknown option 'list-${rest}' — valid variants: ` +
    "list-order, list-letters, list-priorities, list-types, list-batches, " +
    "list-bugs, list-features, list-epics, list-tasks"
  );
}

/**
 * Parse the option region. Mode keywords count only as the FIRST token, so a
 * directive that happens to start with a keyword-rich sentence after the mode
 * (`ask List bug items and propose…`) keeps its mode and treats the rest as
 * directive. Scheme/group/filter keywords are consumed until the first token
 * that matches none; everything from there is the directive.
 * Unknown `list-*` sugar is a hard error (typo guard with usage hint).
 */
export function parseFindWorkArgs(argv: string[]): { args: FindWorkArgs; error?: string } {
  const args: FindWorkArgs = {
    mode: "list",
    scheme: "order",
    batches: false,
    kinds: [],
    query: "",
  };
  if (argv.length === 0) return { args };

  let i = 0;
  const first = normToken(argv[0] ?? "");
  const firstSugar = LIST_SUGAR_RE.exec(first);
  if ((MODE_KEYWORDS as readonly string[]).includes(first)) {
    args.mode = first as WorkMode;
    i = 1;
  } else if (firstSugar?.[1]) {
    if (!applyKeyword(first, args, false)) {
      return { args, error: unknownListSugar(firstSugar[1]) };
    }
    i = 1;
  }

  for (; i < argv.length; i++) {
    const word = normToken(argv[i] ?? "");
    if (applyKeyword(word, args, (MODE_KEYWORDS as readonly string[]).includes(first))) continue;
    // A later mode word (or any unrecognized token) starts the directive —
    // e.g. `ask List bug items and propose…` keeps mode=ask and directive
    // "List bug items and propose…".
    args.query = argv.slice(i).join(" ");
    break;
  }
  return { args };
}
