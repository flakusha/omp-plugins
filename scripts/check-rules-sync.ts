#!/usr/bin/env bun
// check-rules-sync.ts — validate the universal rules bundle (schema + laydown).
//
// TS port of scripts/check-rules-sync.sh (bun >= 1.4, node: builtins only).
//
//   1. Schema: every plugins/oh-my-pi-integration/rules/*.md carries the
//      frontmatter contract — `name` equals the filename stem, non-empty
//      `description`, non-empty `condition`, and a `scope` limited to
//      text | thinking | tool:<name>[(pattern)].
//   2. Sync: the installer's dry-run lays exactly as many rules as ship —
//      catches renamed/removed rules that a stale target would keep, and
//      laydown regressions (a rule that stopped being laid down).
//
// Usage:
//   bun scripts/check-rules-sync.ts [--schema-only]   # skip the installer dry-run
//
// Deliberate differences from the bash original:
//   - shells out to `bun scripts/install.ts` instead of `bash scripts/install.sh`;
//   - if scripts/install.ts is absent, the laydown half is skipped with an
//     explicit SKIP line and the script exits 0 (the .sh would fail hard);
//   - env `OMP_CHECKS_ROOT` overrides the repo root (test fixture support).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.env.OMP_CHECKS_ROOT ?? join(import.meta.dir, "..");
const VALID_SCOPES: ReadonlySet<string> = new Set(["text", "thinking"]);
const TOOL_SCOPE_RE = /^tool:[a-z][a-z0-9-]*(\([^)]*\))?$/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

/** Python repr()-style rendering for failure messages: strings single-quoted, absent fields None. */
function repr(value: string | undefined): string {
  return value === undefined ? "None" : `'${value}'`;
}

/** Python str.strip('"') semantics: strips ALL leading/trailing double quotes. */
function stripQuotes(value: string): string {
  return value.replace(/^"+/, "").replace(/"+$/, "");
}

/** Frontmatter body between the opening and closing `---` fences, or undefined when absent. */
export function extractFrontmatter(text: string): string | undefined {
  const m = FRONTMATTER_RE.exec(text);
  return m ? (m[1] ?? "") : undefined;
}

/** First-occurrence-wins `key: value` field map; values are trimmed and unquoted. */
export function parseFrontmatterFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key !== "" && !Object.hasOwn(fields, key)) {
      fields[key] = stripQuotes(line.slice(idx + 1).trim());
    }
  }
  return fields;
}

/** Scope list parsing: `a, b` / `[a, "b"]` -> ["a", "b"] (empty entries dropped). */
export function scopeItemsOf(scopeRaw: string): string[] {
  const stripped = scopeRaw.replace(/^[[\]]+/, "").replace(/[[\]]+$/, "");
  const items: string[] = [];
  for (const x of stripped.split(",")) {
    if (x.trim() === "") continue;
    items.push(stripQuotes(x.trim()));
  }
  return items;
}

/** All schema failures for one rule file, in the .sh's check order. */
export function validateRule(fileName: string, text: string): string[] {
  const stem = fileName.slice(0, -".md".length);
  const body = extractFrontmatter(text);
  if (body === undefined) return [`FAIL ${fileName}: missing frontmatter`];
  const failures: string[] = [];
  const fields = parseFrontmatterFields(body);
  if (fields.name !== stem) {
    failures.push(
      `FAIL ${fileName}: frontmatter name ${repr(fields.name)} != filename stem ${repr(stem)}`,
    );
  }
  if (!fields.description) failures.push(`FAIL ${fileName}: missing description`);
  if (!fields.condition) failures.push(`FAIL ${fileName}: missing condition`);
  const items = scopeItemsOf(fields.scope ?? "");
  if (items.length === 0) {
    failures.push(`FAIL ${fileName}: missing/empty scope`);
  } else {
    for (const it of items) {
      if (!VALID_SCOPES.has(it) && !TOOL_SCOPE_RE.test(it)) {
        failures.push(`FAIL ${fileName}: invalid scope entry ${repr(it)}`);
      }
    }
  }
  return failures;
}

export interface SchemaResult {
  failures: string[];
  checked: number;
}

export function checkSchemaEntries(
  entries: ReadonlyArray<{ name: string; text: string }>,
): SchemaResult {
  const failures: string[] = [];
  let checked = 0;
  for (const { name, text } of entries) {
    if (!name.endsWith(".md")) continue;
    checked += 1;
    failures.push(...validateRule(name, text));
  }
  return { failures, checked };
}

export function checkRulesSchema(rulesDir: string): SchemaResult {
  const entries = readdirSync(rulesDir)
    .sort()
    .map((name) => ({ name, text: readFileSync(join(rulesDir, name), "utf8") }));
  return checkSchemaEntries(entries);
}

export function schemaSummary(result: SchemaResult): string {
  return `checked ${result.checked} rules, ${result.failures.length} failures`;
}

/**
 * Pre-creates the profile fixture dirs a real `omp --profile <name>` run would have
 * made, so the installer's prerequisite gate (PROFILE-LOADER-RESOLUTION.md) does
 * not abort with exit 4. This exercises the install path, not the gate.
 */
function bootstrapProfileFixture(target: string): void {
  const profilesDir = join(REPO_ROOT, "profiles");
  if (!existsSync(profilesDir)) return;
  for (const ent of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !existsSync(join(profilesDir, ent.name, "agent"))) continue;
    mkdirSync(join(target, ".omp", "profiles", ent.name, "agent"), { recursive: true });
  }
}

/**
 * Lines the installer dry-run prints mentioning `.omp/(agent/)?rules/` — one per
 * laid rule destination (dual install: agent/rules/ + rules/). Returns undefined
 * when scripts/install.ts does not exist yet, meaning: skip the laydown half.
 */
export async function countLaidDownRules(): Promise<number | undefined> {
  const installer = join(REPO_ROOT, "scripts", "install.ts");
  if (!existsSync(installer)) return undefined;
  const tmp = mkdtempSync(join(tmpdir(), "rules-check-"));
  try {
    bootstrapProfileFixture(tmp);
    const proc = Bun.spawn([process.execPath, installer, "--dry-run", "--target", tmp], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    // The .sh pipes combined output through `grep -cE` (with `|| true`), so a
    // failed installer still has its partial output counted; the laid/expected
    // comparison below is what surfaces the failure.
    const laidLine = /\.omp\/(agent\/)?rules\//;
    return `${out}\n${err}`.split("\n").filter((line) => laidLine.test(line)).length;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const schemaOnly = argv.includes("--schema-only");
  const rulesDir = join(REPO_ROOT, "plugins", "oh-my-pi-integration", "rules");
  console.log(`==> rules schema check (${rulesDir})`);
  let schema: SchemaResult;
  try {
    schema = checkRulesSchema(rulesDir);
  } catch {
    console.error("ERROR: rules schema broken");
    return 1;
  }
  for (const failure of schema.failures) console.log(failure);
  console.log(schemaSummary(schema));
  if (schema.failures.length > 0) {
    console.error("ERROR: rules schema broken");
    return 1;
  }
  if (!schemaOnly) {
    console.log("==> rules laydown sync (installer dry-run)");
    const laid = await countLaidDownRules();
    if (laid === undefined) {
      console.log("    SKIP: scripts/install.ts not present yet — skipping laydown sync check");
    } else {
      const expected = schema.checked * 2;
      console.log(`    shipped: ${schema.checked}   laid: ${laid} (expected: ${expected})`);
      if (laid !== expected) {
        console.error(
          `ERROR: laid (${laid}) != expected (${expected}) — rules may not be dual-installed correctly`,
        );
        return 1;
      }
    }
  }
  console.log("==> rules bundle OK");
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
