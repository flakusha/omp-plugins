#!/usr/bin/env bun
// check-shipment.ts — guard against shipping dev-only / non-runtime files into a
// profile. omp walks the plugin package tree and tries to load any *.ts it finds
// (hooks/pre, top-level agent/extensions). Shipping the unit tests
// (`__tests__/`) or leftover `.bak`/`.original` files breaks the profile:
//   * a test loaded as a hook/extension -> "Cannot use describe outside of the
//     test runner";
//   * a helper .ts at the top of agent/extensions (non-factory) -> "Extension
//     does not export a valid factory function".
//
// Performs a real (non dry-run) install into an isolated temp target via
// `bun scripts/install.ts --target <tmp>` and asserts the shipped tree contains
// no `__tests__` dirs, no `.bak`/`.original` files, and that the only
// top-level .ts under .omp/agent/extensions/ is the index.ts factory.
//
// TS port of scripts/check-shipment.sh. Deliberate differences from the .sh:
//   - invokes `bun scripts/install.ts` instead of `bash scripts/install.sh`;
//   - exits 1 with a clear ERROR when scripts/install.ts is missing (the .sh
//     relied on raw shell exit-127 noise);
//   - env `OMP_CHECKS_ROOT` overrides the repo root (test fixture support).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = process.env.OMP_CHECKS_ROOT ?? join(import.meta.dir, "..");

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

/** Recursive count of directories named `name` under root (find -type d -name). */
export function countDirsNamed(root: string, name: string): number {
  if (!existsSync(root)) return 0;
  let count = 0;
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name === name) count += 1;
      walk(join(dir, ent.name));
    }
  };
  walk(root);
  return count;
}

/** Recursive count of `*.bak` / `*.original` files under root (find -name tests). */
export function countLeftoverFiles(root: string): number {
  if (!existsSync(root)) return 0;
  let count = 0;
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(join(dir, ent.name));
      else if (ent.isFile() && (ent.name.endsWith(".bak") || ent.name.endsWith(".original"))) {
        count += 1;
      }
    }
  };
  walk(root);
  return count;
}

/** Newline-joined sorted names of top-level `*.ts` files in dir (find -maxdepth 1). */
export function listTopLevelTs(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isFile() && ent.name.endsWith(".ts"))
    .map((ent) => ent.name)
    .sort()
    .join("\n");
}

/**
 * The only acceptable top-level .ts under .omp/agent/extensions/ is the index.ts
 * factory — anything else fails to load as an extension. Returns the .sh's
 * failure message, or undefined when the listing is clean.
 */
export function topLevelTsError(tops: string): string | undefined {
  if (tops === "index.ts") return undefined;
  return `non-factory .ts at top of agent/extensions (would fail to load): ${tops}`;
}

/**
 * Relative imports in *.ts under root that do not resolve to a shipped file
 * (exact, +".ts", or +"/index.ts"). Catches payload-manifest drift: a module
 * imported by a shipped file but missing from the installer's AGENT_PAYLOADS
 * fails omp's extension load at runtime ("Cannot find module ... imported
 * from ..."), killing every extension behind the entry. Bare and node:
 * specifiers are ignored — only the relative graph is checked. `?mtime=`
 * cache-bust suffixes are stripped before resolution.
 */
export function unresolvedImports(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith(".ts")) files.push(p);
    }
  };
  walk(root);
  const IMPORT_RE =
    /\bfrom\s+["'](\.[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+)["']|\bimport\s+["'](\.[^"']+)["']/g;
  const unresolved: string[] = [];
  for (const file of files) {
    const rel = relative(root, file);
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\?.*$/, "");
      const base = resolve(dirname(file), spec);
      const resolved = [base, `${base}.ts`, join(base, "index.ts")].some(
        (c) => existsSync(c) && statSync(c).isFile(),
      );
      if (!resolved) unresolved.push(`${rel} -> ${spec}`);
    }
  }
  return unresolved.sort();
}

function fail(message: string): number {
  console.error(`ERROR: ${message}`);
  return 1;
}

export async function main(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), "ship-check-"));
  try {
    bootstrapProfileFixture(tmp);
    console.log(`==> shipment check (install into ${tmp})`);
    const installer = join(REPO_ROOT, "scripts", "install.ts");
    if (!existsSync(installer)) {
      return fail("scripts/install.ts not found — cannot run the shipment check");
    }
    const proc = Bun.spawn([process.execPath, installer, "--target", tmp], {
      cwd: REPO_ROOT,
      stdout: "ignore",
      stderr: "inherit",
    });
    const installCode = await proc.exited;
    if (installCode !== 0) return installCode;

    const ompDir = join(tmp, ".omp");
    const instPkg = join(ompDir, "plugins", "node_modules", "oh-my-pi-integration");
    const instExt = join(ompDir, "agent", "extensions");

    // 1) no unit-test trees may ship in the plugin package or the agent payloads
    const nTests = countDirsNamed(ompDir, "__tests__");
    console.log(`    __tests__ dirs shipped: ${nTests}`);
    if (nTests !== 0) return fail(`dev unit tests shipped into profile (${nTests} __tests__ dirs)`);
    if (!existsSync(instPkg)) return fail(`plugin package not installed at ${instPkg}`);

    // 2) no leftover .bak / .original files ship in the package
    const nBak = countLeftoverFiles(instPkg);
    console.log(`    .bak/.original shipped: ${nBak}`);
    if (nBak !== 0) return fail("backup/leftover files shipped into plugin package");

    // 3) only the real extension factory sits at the top of agent/extensions
    const tops = listTopLevelTs(instExt);
    console.log(`    top-level agent/extensions .ts: ${tops === "" ? "<none>" : tops}`);
    const topsError = topLevelTsError(tops);
    if (topsError !== undefined) return fail(topsError);

    // 4) every relative import in the shipped agent extensions tree resolves
    //    on disk — one dangling module stops the whole entry at load
    const dangling = unresolvedImports(instExt);
    console.log(`    unresolved relative imports: ${dangling.length}`);
    if (dangling.length !== 0) {
      return fail(
        `dangling relative import(s) in shipped agent extensions:\n      ${dangling.join("\n      ")}`,
      );
    }

    console.log("==> shipment check OK");
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(await main());
}
