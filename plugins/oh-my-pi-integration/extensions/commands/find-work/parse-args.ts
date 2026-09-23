/**
 * `/find-work` argument parsing: the mode keyword counts only as the FIRST
 * token; scheme/group/filter keywords are consumed until the first free-text
 * token, which starts the directive. `list-<canonical>` is a sugar that
 * implies the option region; any other `list-*` is rejected as a typo so the
 * parser never silently diverges from the advertised sugar set.
 */

import {
  DIRECTIVE_FLAG_RE,
  FAST_FLAG_RE,
  GROUP_KEYWORDS,
  isCanonicalListSugar,
  KIND_KEYWORDS,
  LIST_SUGAR_RE,
  LIST_SUGAR_SUFFIXES,
  MODE_KEYWORDS,
  SCHEME_KEYWORDS,
  SEARCH_FLAG_RE,
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
 *
 * Flags are recognized anywhere (before or after free text starts):
 *   -s / --search <text...>          fuzzy search request (implies fast mode)
 *   -m / -d / --directive <text...>  user directive + approach recommendation
 *   --fast                           skip live tool findings (full repo check)
 * A value flag consumes tokens until the next flag token, so multi-word
 * values need no quoting; flag values are raw text (keywords inside a value
 * are never applied).
 */
/**
 * Handle one flag token (`-s`/`-m`/`-d`/`--search`/`--directive`/`--fast`).
 * Returns null when `token` is not a flag; otherwise the consumed token count
 * plus an optional error (value flags require a non-empty value). A value
 * flag consumes tokens until the next flag token, so multi-word values need
 * no quoting; flag values are raw text (keywords inside are never applied).
 */
function isFlagToken(token: string): boolean {
  return SEARCH_FLAG_RE.test(token) || DIRECTIVE_FLAG_RE.test(token) || FAST_FLAG_RE.test(token);
}

function applyFlagToken(
  argv: string[],
  index: number,
  args: FindWorkArgs,
): { consumed: number; error?: string } | null {
  const token = argv[index] ?? "";
  if (FAST_FLAG_RE.test(token)) {
    args.fast = true;
    return { consumed: 1 };
  }
  const isSearch = SEARCH_FLAG_RE.test(token);
  if (!isSearch && !DIRECTIVE_FLAG_RE.test(token)) return null;
  const value: string[] = [];
  let next = index + 1;
  while (next < argv.length && !isFlagToken(argv[next] ?? "")) {
    value.push(argv[next] ?? "");
    next++;
  }
  if (value.length === 0) {
    return {
      consumed: 1,
      error: `'${token}' requires a value — e.g. ${
        isSearch ? "-s perf audit" : "-m fix the parser, tests first"
      }`,
    };
  }
  if (isSearch) args.search = value.join(" ");
  else args.directive = value.join(" ");
  return { consumed: next - index };
}

/**
 * Apply one option-region token (sugar/scheme/group/kind). Returns whether
 * the token was consumed; `error` set means the caller must fail parsing.
 */
function applyOptionToken(word: string, args: FindWorkArgs): { consumed: boolean; error?: string } {
  const sugarSuffix = LIST_SUGAR_RE.exec(word)?.[1];
  if (sugarSuffix !== undefined) {
    if (!isCanonicalListSugar(word)) {
      return {
        consumed: true,
        error: `unknown option 'list-${sugarSuffix}' — valid variants: ${CANONICAL_LIST_SUGAR_HINT}`,
      };
    }
    applyKeyword(sugarSuffix, args);
    return { consumed: true };
  }
  return { consumed: applyKeyword(word, args) };
}

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

  const queryParts: string[] = [];
  let inDirective = false;
  while (i < argv.length) {
    const flag = applyFlagToken(argv, i, args);
    if (flag) {
      if (flag.error) return { args, error: flag.error };
      i += flag.consumed;
      continue;
    }
    const word = normToken(argv[i] ?? "");
    if (!inDirective) {
      // A later mode word (or any unrecognized token) starts the directive —
      // e.g. `ask List bug items and propose…` keeps mode=ask.
      const applied = applyOptionToken(word, args);
      if (applied.error) return { args, error: applied.error };
      if (applied.consumed) {
        i++;
        continue;
      }
      inDirective = true;
    }
    queryParts.push(argv[i] ?? "");
    i++;
  }
  args.query = queryParts.join(" ");
  return { args };
}
