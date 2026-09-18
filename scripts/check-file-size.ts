#!/usr/bin/env bun
/**
 * Line-count guard for extension/script sources (loop-lore convention).
 *
 * Surfaces source files exceeding the 250L soft ceiling so agents split them
 * before they become god-modules (sample: loop-lore scripts/check-file-size.ts,
 * mirroring its 04-code-organization convention: <200L target, 250L ceiling).
 *
 * Exclusions:
 * - Test files (`*.test.ts`) may legitimately be large.
 * - Per-file override: a top-of-file `// size-allow: N` directive (within the
 *   first 5 lines) sets a larger line budget for that one file. Use sparingly.
 *
 * Modes:
 * - Default: warns, exits 0 — non-blocking nudge
 * - `--strict`: exits 1 for any file over the limit — CI gate
 * - `--limit N`: override the 250L threshold
 *
 * Usage: `bun scripts/check-file-size.ts [--strict] [--limit N]`
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const LIMIT_ARG = args.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split("=")[1] ?? "", 10) : 250;
const ROOTS = ["plugins/oh-my-pi-integration/extensions", "scripts"];
const SIZE_ALLOW_RE = /^\/\/\s*size-allow:\s*(\d+)\s*$/m;
const HEADER_BYTES = 512;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) yield abs;
  }
}

let errors = 0;
let warnings = 0;
const seen = new Set<string>();
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    const allow = text.slice(0, HEADER_BYTES).match(SIZE_ALLOW_RE);
    const fileLimit = allow ? Number.parseInt(allow[1] ?? "", 10) : LIMIT;
    const lines = text.split("\n").length;
    if (lines > fileLimit) {
      const msg = `[size] ${file}: ${lines}L exceeds ${fileLimit}L limit`;
      if (STRICT) {
        console.error(`${msg} — must split`);
        errors++;
      } else {
        console.warn(`${msg} — consider splitting`);
        warnings++;
      }
    }
  }
}

if (STRICT && errors > 0) {
  console.error(`[size] ${errors} file(s) over ${LIMIT}L — gate failed.`);
  process.exit(1);
}
if (warnings > 0) {
  console.warn(`[size] ${warnings} file(s) over ${LIMIT}L. Non-blocking — split when convenient.`);
}
process.exit(0);
