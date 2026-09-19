/**
 * `/find-work` argument parsing: the mode keyword counts only as the FIRST
 * token; scheme/group/filter keywords are consumed until the first free-text
 * token, which starts the directive. `list-<canonical>` is a sugar that
 * implies the option region; any other `list-*` is rejected as a typo so the
 * parser never silently diverges from the advertised sugar set.
 */

import {
  GROUP_KEYWORDS,
  isCanonicalListSugar,
  KIND_KEYWORDS,
  LIST_SUGAR_RE,
  LIST_SUGAR_SUFFIXES,
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

/** Apply a non-sugar option-region keyword (scheme/group/kind). */
function applyKeyword(word: string, args: FindWorkArgs): boolean {
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
  return false;
}

/** Canonical `list-<suffix>` variants advertised to users (typo guard). */
const CANONICAL_LIST_SUGAR_HINT = LIST_SUGAR_SUFFIXES.map((s) => `list-${s}`).join(", ");

/**
 * Parse the option region. Mode keywords count only as the FIRST token, so a
 * directive that happens to start with a keyword-rich sentence after the mode
 * (`ask List bug items and propose…`) keeps its mode and treats the rest as
 * directive. Scheme/group/filter keywords are consumed until the first token
 * that matches none; everything from there is the directive. `list-*` is
 * canonical-suffix-only: tab completion and the unknown-sugar error text
 * enumerate the same set, so invented or near-miss suffixes (`list-bug`,
 * `list-task`, `list-priority`) error out at any position rather than
 * silently consuming via the older recursion.
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
  if ((MODE_KEYWORDS as readonly string[]).includes(normToken(argv[0] ?? ""))) {
    args.mode = normToken(argv[0] ?? "") as WorkMode;
    i = 1;
  }

  for (; i < argv.length; i++) {
    const word = normToken(argv[i] ?? "");
    const sugarSuffix = LIST_SUGAR_RE.exec(word)?.[1];
    if (sugarSuffix !== undefined) {
      if (!isCanonicalListSugar(word)) {
        return { args, error: `unknown option 'list-${sugarSuffix}' — valid variants: ${CANONICAL_LIST_SUGAR_HINT}` };
      }
      applyKeyword(sugarSuffix, args);
      continue;
    }
    if (applyKeyword(word, args)) continue;
    // A later mode word (or any unrecognized token) starts the directive —
    // e.g. `ask List bug items and propose…` keeps mode=ask and directive
    // "List bug items and propose…".
    args.query = argv.slice(i).join(" ");
    break;
  }
  return { args };
}
