// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * bashInterceptor pattern-list merge: parses a YAML config's
 * `bashInterceptor.patterns` list, normalizes entries for quote-tolerant
 * comparison, and computes the diff between src and dst. Used by install
 * to merge new patterns into a user-modified dst config without touching
 * unrelated bytes.
 */

const BASH_INTERCEPTOR_RE = /^bashInterceptor:\s*$/;
const PATTERNS_KEY_RE = /^\s+patterns:\s*$/;
const PATTERN_ENTRY_RE = /^\s+- pattern:/;
const TOP_LEVEL_RE = /^\S/;

/**
 * Unescape a quoted YAML scalar: single-quoted `''` -> `'`; double-quoted
 * escapes (\\, \", \n, \t, \r, \xNN, \uNNNN) -> their characters. Required so
 * a dst pattern stored as `"^\\s*git..."` compares equal to the same regex
 * stored unquoted in src.
 */
function unescapeYamlScalar(s: string, quote: string): string {
  if (quote === "'") return s.replace(/''/g, "'");
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0"ntr\\])/g, (_m, esc: string) => {
    if (esc[0] === "u" || esc[0] === "x") {
      return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    }
    switch (esc) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        return esc;
    }
  });
}

/**
 * Normalize a `- pattern:` entry line for matching: strip the list marker and
 * key, surrounding quotes (unescaping quoted YAML scalars), and surrounding
 * whitespace. Quote-tolerant: a quoted dst pattern matches an unquoted src
 * pattern and vice versa.
 */
export function normalizePatternLine(line: string): string {
  let s = line.trim();
  const marker = /^-\s*pattern:\s*/.exec(s);
  if (marker !== null) s = s.slice(marker[0]?.length ?? 0).trim();
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if (first === last && (first === '"' || first === "'")) {
      s = unescapeYamlScalar(s.slice(1, -1), first).trim();
    }
  }
  return s;
}

/** Find the first line index inside the `bashInterceptor.patterns` list. */
function findPatternsStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!BASH_INTERCEPTOR_RE.test(lines[i] ?? "")) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const probe = lines[j] ?? "";
      if (PATTERNS_KEY_RE.test(probe)) return j + 1;
      if (TOP_LEVEL_RE.test(probe)) break;
    }
    return -1;
  }
  return -1;
}

/** Collect `- pattern:` entry blocks until the next top-level key. */
function collectPatternBlocks(lines: string[], start: number): string[][] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (PATTERN_ENTRY_RE.test(line)) {
      if (current !== null) blocks.push(current);
      current = [line];
      continue;
    }
    if (current === null) {
      if (TOP_LEVEL_RE.test(line)) break;
      continue;
    }
    if (TOP_LEVEL_RE.test(line)) break; // next top-level key: list ended
    current.push(line);
  }
  if (current !== null) blocks.push(current);
  return blocks;
}

/** Split a `bashInterceptor.patterns` list into verbatim entry blocks. */
function parsePatternBlocks(text: string): string[][] {
  const lines = text.split("\n");
  const start = findPatternsStart(lines);
  if (start === -1) return [];
  return collectPatternBlocks(lines, start);
}

/**
 * Index of the `bashInterceptor:` section line, or -1 if absent.
 * Anchor to the bashInterceptor section: never enter list-tracking from
 * an unrelated `patterns:` key elsewhere in the file.
 */
function findBashInterceptorLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (BASH_INTERCEPTOR_RE.test(lines[i] ?? "")) return i;
  }
  return -1;
}

/**
 * Index just past the last `- pattern:` entry block inside
 * `bashInterceptor.patterns`. Returns null when the section has no
 * pattern list (we must not invent YAML structure).
 */
function findPatternsInsertIndex(lines: string[], bi: number): number | null {
  let last: number | null = null;
  let inList = false;
  let entryOpen = false;
  for (let i = bi + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (TOP_LEVEL_RE.test(line)) break; // left the bashInterceptor section
    if (PATTERNS_KEY_RE.test(line)) {
      inList = true;
      entryOpen = false;
      continue;
    }
    if (!inList) continue;
    if (PATTERN_ENTRY_RE.test(line)) entryOpen = true;
    if (entryOpen) last = i; // end of the last entry block (pattern + tool/message lines)
  }
  if (!inList || last === null) return null;
  return last + 1;
}

export interface MergeResult {
  text: string;
  added: string[];
}

/** Splice the missing src blocks into dst's bashInterceptor.patterns list. */
function spliceMissingPatterns(dstYaml: string, missing: string[][]): MergeResult | null {
  const lines = dstYaml.replace(/\n+$/, "").split("\n");
  const bi = findBashInterceptorLine(lines);
  const insertAt = findPatternsInsertIndex(lines, bi);
  if (insertAt === null) return null;
  const addition: string[] = [];
  for (const block of missing) addition.push(...block);
  lines.splice(insertAt, 0, ...addition);
  return {
    text: `${lines.join("\n")}\n`,
    added: missing.map((block) => normalizePatternLine(block[0] ?? "")),
  };
}

/**
 * Compute the merged config for a user-modified config.yml: append every src
 * `- pattern:` entry whose normalized pattern line is absent from dst at the
 * end of dst's `bashInterceptor.patterns` list. Everything else in dst is
 * preserved byte-for-byte; the result always ends with a newline. Returns
 * null when dst has no patterns list (we do not invent YAML structure).
 */
export function mergeInterceptorPatterns(srcYaml: string, dstYaml: string): MergeResult | null {
  const present = new Set(parsePatternBlocks(dstYaml).map((b) => normalizePatternLine(b[0] ?? "")));
  const missing = parsePatternBlocks(srcYaml).filter(
    (block) => !present.has(normalizePatternLine(block[0] ?? "")),
  );
  if (missing.length === 0) return { text: dstYaml, added: [] };
  return spliceMissingPatterns(dstYaml, missing);
}
