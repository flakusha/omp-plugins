/**
 * `/find-work` source detection: pure fs/PATH probes for every work-source
 * surface, plus the usage text and environment summary built from them.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveGiwtConfig } from "../../util/giwt-config";
import { onPath } from "../bookkeep";
import { TODO_SKIP_DIRS, todoExt } from "./todo-scan";
import type { WorkSources } from "./types";

// ---------------------------------------------------------------------------
// Source detection + fetch layer
// ---------------------------------------------------------------------------

interface PkgJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  knip?: unknown;
}

/** Best-effort package.json read; null when absent/unparseable. */
function pkgJsonOf(root: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PkgJson;
  } catch {
    return null;
  }
}

function hasDep(pkg: PkgJson | null, name: string): boolean {
  return (
    typeof pkg?.dependencies?.[name] === "string" ||
    typeof pkg?.devDependencies?.[name] === "string"
  );
}

/** Inside a git checkout (normal `.git` dir or linked-worktree `.git` file). */
export function hasGitRepo(root: string): boolean {
  // existsSync never throws — no try/catch needed.
  return existsSync(join(root, ".git"));
}

export type LintTool = "eslint" | "biome" | "oxlint";

const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  ".eslintrc.js",
  ".eslintrc.cjs",
];

/** Configured linter, eslint first (most specific config wins ties). */
export function detectLintTool(root: string): LintTool | null {
  if (ESLINT_CONFIGS.some((f) => existsSync(join(root, f)))) return "eslint";
  if (existsSync(join(root, "biome.json")) || existsSync(join(root, "biome.jsonc"))) {
    return "biome";
  }
  if (existsSync(join(root, ".oxlintrc.json"))) return "oxlint";
  const pkg = pkgJsonOf(root);
  if (pkg && (hasDep(pkg, "oxlint") || typeof pkg.scripts?.oxlint === "string")) {
    return "oxlint";
  }
  return null;
}

/** Repo opts into test runs via a `test` script. */
export function hasTestScript(root: string): boolean {
  return typeof pkgJsonOf(root)?.scripts?.test === "string";
}

const KNIP_CONFIGS = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.js",
  "knip.ts",
  "knip.config.js",
  "knip.config.ts",
];

/** Knip opted in via config file, package.json#knip, or dependency. */
export function hasKnip(root: string): boolean {
  if (KNIP_CONFIGS.some((f) => existsSync(join(root, f)))) return true;
  const pkg = pkgJsonOf(root);
  if (!pkg) return false;
  return pkg.knip !== undefined || hasDep(pkg, "knip");
}

const JSCPD_CONFIGS = [".jscpd.json", ".jscpdrc", ".jscpdrc.json", "jscpd.json"];

/** Jscpd opted in via config file, dependency, or npm script. */
export function hasJscpd(root: string): boolean {
  if (JSCPD_CONFIGS.some((f) => existsSync(join(root, f)))) return true;
  const pkg = pkgJsonOf(root);
  if (!pkg) return false;
  return (
    hasDep(pkg, "jscpd") || Object.values(pkg.scripts ?? {}).some((cmd) => /\bjscpd\b/.test(cmd))
  );
}

/** Pure fs/PATH detection of every work-source surface for a session cwd. */
export function detectWorkSources(root: string, pathEnv?: string): WorkSources {
  const env = pathEnv ?? process.env.PATH ?? "";
  const trackerCli = ["ticket", "issues", "prs", "gi"].some(
    (cmd) =>
      existsSync(join(root, `scripts/worktree/${cmd}.ts`)) ||
      existsSync(join(root, `scripts/worktree/${cmd}.mjs`)),
  );
  const giwtConfig = resolveGiwtConfig(root);
  return {
    receipt: existsSync(giwtConfig.receiptPath),
    plan: existsSync(giwtConfig.planDir),
    gh: onPath("gh", env),
    gitIssue: onPath("git-issue", env) || onPath("gi", env),
    jira: onPath("jira", env),
    glab: onPath("glab", env),
    trackerCli,
    giwtLedger: giwtConfig.available && existsSync(giwtConfig.ledgerPath),
    giwtRuns: giwtConfig.available && existsSync(giwtConfig.runlogDir),
    todo: hasTodoSource(root),
    merges: hasGitRepo(root) && onPath("git", env),
    lint: detectLintTool(root) !== null,
    typecheck: existsSync(join(root, "tsconfig.json")),
    tests: hasTestScript(root),
    knip: hasKnip(root),
    jscpd: hasJscpd(root),
  };
}

/** Any handler-fetchable source at all (jira/glab are turn-only). */
export function hasFetchableSource(sources: WorkSources): boolean {
  return (
    sources.receipt ||
    sources.plan ||
    sources.gh ||
    sources.gitIssue ||
    sources.trackerCli ||
    sources.giwtLedger ||
    sources.giwtRuns ||
    sources.todo ||
    sources.merges ||
    sources.lint ||
    sources.typecheck ||
    sources.tests ||
    sources.knip ||
    sources.jscpd
  );
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** Environment summary used by usage output and the agent-fallback prompt. */
export function describeSources(sources: WorkSources): string {
  return (
    `receipt ${yesNo(sources.receipt)}; .plan ${yesNo(sources.plan)}; gh ${yesNo(sources.gh)}; ` +
    `git-issue ${yesNo(sources.gitIssue)}; jira ${yesNo(sources.jira)}; glab ${yesNo(sources.glab)}; ` +
    `worktree-tracker ${yesNo(sources.trackerCli)}; giwt-ledger ${yesNo(sources.giwtLedger)}; giwt-runs ${yesNo(sources.giwtRuns)}; ` +
    `todo ${yesNo(sources.todo)}; merges ${yesNo(sources.merges)}; lint ${yesNo(sources.lint)}; ` +
    `typecheck ${yesNo(sources.typecheck)}; tests ${yesNo(sources.tests)}; knip ${yesNo(sources.knip)}; jscpd ${yesNo(sources.jscpd)}`
  );
}

export function findWorkUsage(sources: WorkSources): string {
  return [
    "usage: /find-work [list|table|ask|orchestrate] [order|letters|priorities|types] [batches] " +
      "[bugs|features|epics|tasks] [directive...]",
    `sources: ${describeSources(sources)}`,
    "orchestrate: auto-delegate items to parallel subagents grouped by domain.",
    "tool findings (lint/typecheck/tests/knip/jscpd) run live under a shared time budget; TODO comments and unmerged branches run live when detected.",
    "jira/glab are resolved inside an agent turn (use `/find-work ask` with a directive).",
  ].join("\n");
}

/**
 * Cheap applicability probe: does root contain any scannable source file?
 * Bounded two-level walk — keeps `todo` false for empty/doc-only dirs so
 * bare `/find-work` still shows usage there.
 */
export function hasTodoSource(root: string): boolean {
  try {
    const top = readdirSync(root, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isFile() && todoExt(entry.name)) return true;
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !(TODO_SKIP_DIRS[entry.name] ?? false)
      ) {
        try {
          const sub = readdirSync(join(root, entry.name), { withFileTypes: true });
          if (sub.some((e) => e.isFile() && todoExt(e.name))) return true;
        } catch {}
      }
    }
  } catch {
    return false;
  }
  return false;
}
