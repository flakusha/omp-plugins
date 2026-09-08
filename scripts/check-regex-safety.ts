#!/usr/bin/env bun
// check-regex-safety.ts — ReDoS / perf lint for TTSR rule `condition` regexes.
//
// TS port of scripts/check-regex-safety.sh. Scans
// plugins/oh-my-pi-integration/rules/*.md frontmatter for:
//
//   1. ERROR — unbounded `.*` (dot-star): after a `[\s\S]*` lead, a bare `.*`
//      between two anchors backtracks quadratically (measured 100–500ms per
//      `.test()` on ~4 KB). Fix: bound it (`[\s\S]{0,40}?`) or split the facet
//      into two lookaheads (`(?=[\s\S]*X)(?=[\s\S]*Y)`).
//
//   2. ERROR — unanchored lookahead chain: starts with `(?=` but not `^(?=`,
//      i.e. a zero-width regex with no anchor; on non-matching input .test()
//      retries the full greedy scan at every stream position -> O(n^2).
//      Fix: prepend `^` (semantically identical).
//
//   3. WARN — greedy `[\s\S]*` lead in a lookahead: in Bun/JavaScriptCore the
//      greedy prefix defeats the engine's literal fast-path search
//      (~35,000× slower than a bare pattern). Constant-factor per-delta cost,
//      structural and not fixable in rule text alone — hence a warning.
//
// Exit 1 only on errors (1/2). Greedy leads are counted, not fatal.
//
// Deliberate differences from the bash original:
//   - JSON parse error detail text differs (JS JSON.parse message vs Python's);
//   - env `OMP_CHECKS_ROOT` overrides the repo root (test fixture support).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.env.OMP_CHECKS_ROOT ?? join(import.meta.dir, "..");
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
// Bare `.*` — bounded quantifiers (`{0,N}`) are fine; a bare `.*` is the signal.
const DOTSTAR_RE = /\.\*/;
// Greedy `[\s\S]*` lead (informational JSC hazard, not fixable in rule text).
const GREEDY_LEAD_RE = /\(\?=\[\\s\\S\]\*/;

export interface ConditionHazards {
  dotStar: boolean;
  unanchored: boolean;
  greedyLead: boolean;
}

export function classifyCondition(cond: string): ConditionHazards {
  return {
    dotStar: DOTSTAR_RE.test(cond),
    unanchored: cond.startsWith("(?=") && !cond.startsWith("^(?="),
    greedyLead: GREEDY_LEAD_RE.test(cond),
  };
}

export interface RegexSafetyResult {
  errors: string[];
  warnings: number;
  checked: number;
}

function firstCondition(text: string): string | undefined {
  const fm = FRONTMATTER_RE.exec(text);
  if (!fm) return undefined;
  for (const line of (fm[1] ?? "").split("\n")) {
    if (line.startsWith("condition:")) {
      const idx = line.indexOf(":");
      return line.slice(idx + 1).trim();
    }
  }
  return undefined;
}

/** Processes one rule file; appends errors and returns the greedy-lead warnings found. */
function checkRuleCondition(name: string, text: string, errors: string[]): number {
  const cond = firstCondition(text);
  if (!cond) return 0; // bash parity: empty/whitespace `condition:` is skipped, not a JSON error
  // Unescape the JSON/YAML condition to its single-backslash regex form. Fail
  // loud on a JSON parse error — silently skipping (the previous behavior)
  // shipped a broken regex into the live profile with no check-layer signal.
  let parsed: unknown;
  try {
    parsed = JSON.parse(cond);
  } catch (e) {
    errors.push(`ERROR ${name}: cannot parse condition as JSON: ${(e as Error).message}`);
    return 0;
  }
  const conds = typeof parsed === "string" ? [parsed] : parsed;
  if (!Array.isArray(conds) || conds.some((c) => typeof c !== "string")) {
    throw new Error(`condition of ${name} is neither a JSON string nor a string array`);
  }
  let warnings = 0;
  for (const c of conds as string[]) {
    const hazards = classifyCondition(c);
    if (hazards.dotStar) {
      errors.push(`ERROR ${name}: unbounded .* (quadratic backtracking): ${c.slice(0, 80)}...`);
    }
    if (hazards.unanchored) {
      errors.push(`ERROR ${name}: unanchored lookahead chain (O(n^2) ReDoS): ${c.slice(0, 80)}...`);
    }
    if (hazards.greedyLead) warnings += 1; // counted, not printed per-file (every rule has one)
  }
  return warnings;
}

export function checkRegexSafetyEntries(
  entries: ReadonlyArray<{ name: string; text: string }>,
): RegexSafetyResult {
  const errors: string[] = [];
  let warnings = 0;
  // The .sh summary counts every directory entry (len(os.listdir)), not just .md.
  let checked = 0;
  for (const { name, text } of entries) {
    checked += 1;
    if (!name.endsWith(".md")) continue;
    warnings += checkRuleCondition(name, text, errors);
  }
  return { errors, warnings, checked };
}

export function checkRegexSafety(rulesDir: string): RegexSafetyResult {
  const entries = readdirSync(rulesDir)
    .sort()
    .map((name) => ({ name, text: readFileSync(join(rulesDir, name), "utf8") }));
  return checkRegexSafetyEntries(entries);
}

export function regexSafetySummary(result: RegexSafetyResult): string {
  return `checked ${result.checked} rule files: ${result.errors.length} regex-safety errors, ${result.warnings} greedy-lead warnings`;
}

export async function main(): Promise<number> {
  const rulesDir = join(REPO_ROOT, "plugins", "oh-my-pi-integration", "rules");
  try {
    const result = checkRegexSafety(rulesDir);
    for (const error of result.errors) console.log(error);
    console.log(regexSafetySummary(result));
    return result.errors.length > 0 ? 1 : 0;
  } catch (e) {
    console.error(`ERROR: regex safety check failed: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
