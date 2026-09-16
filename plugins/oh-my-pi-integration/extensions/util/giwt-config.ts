// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * giwt config resolver — detect and load giwt settings from session cwd.
 *
 * Supports two config file names:
 *   - `giwt.toml`  (standard, checked first)
 *   - `.giwt.toml` (dotfile variant, checked as fallback)
 *
 * Pure detection: checks if giwt is available and resolves its treeDir,
 * runlogDir, planDir, etc. from the config file, falling back to defaults
 * when absent. Every call site must handle the unavailable case gracefully.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GiwtConfig {
  /** giwt is available (config file or .tmp/giwt dir exists). */
  available: boolean;
  /** Config file used (absolute path), or null when none found. */
  configFile: string | null;
  /** Repo root giwt resolves to (same as session cwd or git root). */
  repoRoot: string;
  /** giwt tree dir (worktree container), absolute. */
  treeDir: string;
  /** giwt runlog dir (.tmp/giwt/runs/), absolute. */
  runlogDir: string;
  /** giwt ledger path (.ledger.jsonl), absolute. */
  ledgerPath: string;
  /** giwt plan dir, absolute. */
  planDir: string;
  /** giwt tickets dir, absolute. */
  ticketsDir: string;
  /** omp dir (where receipt.toml lives), absolute. Default: .omp */
  ompDir: string;
  /** receipt.toml path, absolute. */
  receiptPath: string;
  /** Protected branches (from [branches] section). */
  protectedBranches: string[];
  /** Root/fork-base branch (from [branches] section). */
  rootBranch: string;
  /** Check command (from [commands] section). */
  checkCommand: string;
  /** Test command (from [commands] section). */
  testCommand: string;
  /** Max runs to keep (from [runlog] section). */
  maxRuns: number;
  /** Output format (from [output] section). */
  outputFormat: string;
}

/** Config file names, in precedence order. */
export const CONFIG_FILENAMES = ["giwt.toml", ".giwt.toml"] as const;

/** Default config template — dumped by `/bookkeep config` when no file exists. */
export const DEFAULT_CONFIG_TEMPLATE = `# giwt configuration — place at repo root as giwt.toml or .giwt.toml

[branches]
protected = ["master", "main", "stg", "dev"]
root = "dev"

[paths]
tree = "tree"
tickets = ".plan/tickets"
plan = ".plan"
runlog = ".tmp/giwt"
check_report = ".tmp/check-report.json"
omp_dir = ".omp"

[commands]
check = "bun run check"
test = "bun run test:unit"

[runlog]
max_runs = 200

[output]
format = "simple"
`;

const DEFAULTS = {
  tree: "tree",
  runlog: ".tmp/giwt",
  plan: ".plan",
  tickets: ".plan/tickets",
  ompDir: ".omp",
  protectedBranches: ["master", "main", "stg", "dev"],
  rootBranch: "dev",
  checkCommand: "bun run check",
  testCommand: "bun run test:unit",
  maxRuns: 200,
  outputFormat: "simple",
};

/**
 * Parse a simple TOML key = "value" from a section's body text.
 * Bare-minimum parser: handles quoted strings and bare values.
 */
function tomlValue(section: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m");
  const m = re.exec(section);
  return m?.[1];
}

/** Parse a TOML array value: `["a", "b"]` → ["a", "b"]. */
function tomlArray(section: string, key: string): string[] | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m");
  const m = re.exec(section);
  if (!m?.[1]) return undefined;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/** Parse a TOML integer value. */
function tomlInt(section: string, key: string): number | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, "m");
  const m = re.exec(section);
  return m?.[1] ? Number(m[1]) : undefined;
}

/** Parse a TOML bare (unquoted) string value. */
function tomlBare(section: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*([^\\s\\n]+)`, "m");
  const m = re.exec(section);
  return m?.[1]?.replace(/^"(.*)"$/, "$1");
}

/**
 * Extract a named section from a TOML string.
 * Returns the raw section body, or "" when absent.
 */
function tomlSection(raw: string, name: string): string {
  const header = `[${name}]`;
  const start = raw.indexOf(header);
  if (start < 0) return "";
  const rest = raw.slice(start + header.length);
  const nextSection = rest.search(/^\s*\[/m);
  return nextSection >= 0 ? rest.slice(0, nextSection) : rest;
}

/** Find the first existing config file in root, or null. */
function findConfigFile(root: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Resolve giwt config from session cwd. Pure fs — no subprocess, no side
 * effects. Checks for `giwt.toml` first, then `.giwt.toml`. Falls back to
 * defaults when neither exists.
 */
export function resolveGiwtConfig(cwd: string | undefined): GiwtConfig {
  const root = cwd ?? process.cwd();

  const configFile = findConfigFile(root);
  const available = configFile !== null || existsSync(join(root, ".tmp", "giwt"));

  let treeDir = join(root, DEFAULTS.tree);
  let planDir = join(root, DEFAULTS.plan);
  let ticketsDir = join(root, DEFAULTS.tickets);
  let runlogDir = join(root, DEFAULTS.runlog);
  let ompDir = join(root, DEFAULTS.ompDir);
  let protectedBranches = DEFAULTS.protectedBranches;
  let rootBranch = DEFAULTS.rootBranch;
  let checkCommand = DEFAULTS.checkCommand;
  let testCommand = DEFAULTS.testCommand;
  let maxRuns = DEFAULTS.maxRuns;
  let outputFormat = DEFAULTS.outputFormat;

  if (configFile) {
    try {
      const raw = readFileSync(configFile, "utf8");

      const paths = tomlSection(raw, "paths");
      const tree = tomlValue(paths, "tree");
      const plan = tomlValue(paths, "plan");
      const tickets = tomlValue(paths, "tickets");
      const runlog = tomlValue(paths, "runlog");
      const ompDirVal = tomlValue(paths, "omp_dir");
      if (tree) treeDir = resolve(root, tree);
      if (plan) planDir = resolve(root, plan);
      if (tickets) ticketsDir = resolve(root, tickets);
      if (runlog) runlogDir = resolve(root, runlog);
      if (ompDirVal) ompDir = resolve(root, ompDirVal);

      const branches = tomlSection(raw, "branches");
      const prot = tomlArray(branches, "protected");
      const rootVal = tomlBare(branches, "root");
      if (prot) protectedBranches = prot;
      if (rootVal) rootBranch = rootVal;

      const commands = tomlSection(raw, "commands");
      const check = tomlValue(commands, "check");
      const test = tomlValue(commands, "test");
      if (check) checkCommand = check;
      if (test) testCommand = test;

      const runlogSec = tomlSection(raw, "runlog");
      const maxRunsVal = tomlInt(runlogSec, "max_runs");
      if (maxRunsVal !== undefined) maxRuns = maxRunsVal;

      const output = tomlSection(raw, "output");
      const fmt = tomlBare(output, "format");
      if (fmt) outputFormat = fmt;
    } catch {
      // Keep defaults on parse failure
    }
  }

  return {
    available,
    configFile,
    repoRoot: root,
    treeDir,
    runlogDir,
    ledgerPath: join(treeDir, ".ledger.jsonl"),
    planDir,
    ticketsDir,
    ompDir,
    receiptPath: join(ompDir, "receipt.toml"),
    protectedBranches,
    rootBranch,
    checkCommand,
    testCommand,
    maxRuns,
    outputFormat,
  };
}

/**
 * Check if giwt is available as a CLI tool (bun + giwt source or binary).
 * Pure PATH check — no subprocess.
 */
export function giwtOnPath(pathEnv?: string): boolean {
  const path = pathEnv ?? process.env.PATH ?? "";
  return path.split(":").some((dir) => {
    try {
      return existsSync(join(dir, "giwt"));
    } catch {
      return false;
    }
  });
}

/**
 * Resolve TREE_DIR env for giwt subprocess calls. Aligns giwt's worktree
 * container with omp's OMP_WORKTREE_DIR when set.
 */
export function giwtEnv(cwd: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  const ompWt = process.env.OMP_WORKTREE_DIR;
  if (ompWt) env.TREE_DIR = ompWt;
  if (cwd) env.REPO_ROOT = cwd;
  return env;
}

/**
 * Resolve the receipt.toml path for a session cwd, honoring
 * `paths.omp_dir` from giwt.toml / .giwt.toml (default: `<root>/.omp`).
 * Pure fs read of the config file at most — never throws; falls back to
 * the `.omp` default on any failure.
 */
export function resolveReceiptPath(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  try {
    return resolveGiwtConfig(cwd).receiptPath;
  } catch {
    return join(cwd, ".omp", "receipt.toml");
  }
}

/** Planning subdirectories, resolved against the configured plan root. */
export type PlanSubdir = "tickets" | "epics" | "backlog";

/**
 * Resolve one planning subdirectory for a session cwd, honoring
 * `paths.plan` / `paths.tickets` from giwt.toml / .giwt.toml.
 * The tickets dir honors `paths.tickets` directly; epics/backlog hang
 * off the configured plan root. Defaults preserve the `.plan/*` layout.
 */
export function resolvePlanDir(root: string, subdir: PlanSubdir): string {
  const cfg = resolveGiwtConfig(root);
  if (subdir === "tickets") return cfg.ticketsDir;
  return join(cfg.planDir, subdir);
}

/**
 * Dump the resolved giwt config as a human-readable summary for `/bookkeep config`.
 * Shows the config file used (or template), all resolved paths, and settings.
 */
export function dumpGiwtConfig(cwd: string | undefined): string {
  const cfg = resolveGiwtConfig(cwd);
  const lines: string[] = [];

  lines.push("giwt config:");
  lines.push(`  available: ${cfg.available ? "yes" : "no"}`);
  lines.push(`  config file: ${cfg.configFile ?? "none (using defaults)"}`);

  if (!cfg.configFile) {
    lines.push("");
    lines.push("Default config template (create giwt.toml or .giwt.toml at repo root):");
    lines.push("```toml");
    lines.push(DEFAULT_CONFIG_TEMPLATE.trimEnd());
    lines.push("```");
  }

  lines.push("");
  lines.push("Resolved paths:");
  lines.push(`  tree dir:     ${cfg.treeDir}`);
  lines.push(`  plan dir:     ${cfg.planDir}`);
  lines.push(`  tickets dir:  ${cfg.ticketsDir}`);
  lines.push(`  runlog dir:   ${cfg.runlogDir}`);
  lines.push(`  ledger path:  ${cfg.ledgerPath}`);
  lines.push(`  omp dir:      ${cfg.ompDir}`);
  lines.push(`  receipt path: ${cfg.receiptPath}`);

  lines.push("");
  lines.push("Branches:");
  lines.push(`  protected: ${cfg.protectedBranches.join(", ")}`);
  lines.push(`  root:      ${cfg.rootBranch}`);

  lines.push("");
  lines.push("Commands:");
  lines.push(`  check: ${cfg.checkCommand}`);
  lines.push(`  test:  ${cfg.testCommand}`);

  lines.push("");
  lines.push("Runlog:");
  lines.push(`  max runs: ${cfg.maxRuns}`);
  lines.push(`  output:   ${cfg.outputFormat}`);

  return lines.join("\n");
}
