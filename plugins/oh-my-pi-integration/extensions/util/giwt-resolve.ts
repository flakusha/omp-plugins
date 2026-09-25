// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * giwt config resolution — locate the config file, apply defaults, resolve
 * all giwt/omp paths. Split out of `giwt-config.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tomlArray, tomlBare, tomlInt, tomlSection, tomlValue } from "./giwt-toml";

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

/** Find the first existing config file in root, or null. */
function findConfigFile(root: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Apply [paths] overrides from a parsed giwt config to the resolved-state defaults. */
function applyPathsSection(raw: string, root: string, state: ResolvedDirs): void {
  const paths = tomlSection(raw, "paths");
  const tree = tomlValue(paths, "tree");
  const plan = tomlValue(paths, "plan");
  const tickets = tomlValue(paths, "tickets");
  const runlog = tomlValue(paths, "runlog");
  const ompDirVal = tomlValue(paths, "omp_dir");
  if (tree) state.treeDir = resolve(root, tree);
  if (plan) state.planDir = resolve(root, plan);
  if (tickets) state.ticketsDir = resolve(root, tickets);
  if (runlog) state.runlogDir = resolve(root, runlog);
  if (ompDirVal) state.ompDir = resolve(root, ompDirVal);
}

/** Apply [branches] overrides (protected list, root branch). */
function applyBranchesSection(raw: string, state: ResolvedFields): void {
  const branches = tomlSection(raw, "branches");
  const prot = tomlArray(branches, "protected");
  const rootVal = tomlBare(branches, "root");
  if (prot) state.protectedBranches = prot;
  if (rootVal) state.rootBranch = rootVal;
}

/** Apply [commands] overrides (check, test). */
function applyCommandsSection(raw: string, state: ResolvedFields): void {
  const commands = tomlSection(raw, "commands");
  const check = tomlValue(commands, "check");
  const test = tomlValue(commands, "test");
  if (check) state.checkCommand = check;
  if (test) state.testCommand = test;
}

/** Apply [runlog] overrides (max_runs). */
function applyRunlogSection(raw: string, state: ResolvedFields): void {
  const runlogSec = tomlSection(raw, "runlog");
  const maxRunsVal = tomlInt(runlogSec, "max_runs");
  if (maxRunsVal !== undefined) state.maxRuns = maxRunsVal;
}

/** Apply [output] overrides (format). */
function applyOutputSection(raw: string, state: ResolvedFields): void {
  const output = tomlSection(raw, "output");
  const fmt = tomlBare(output, "format");
  if (fmt) state.outputFormat = fmt;
}

interface ResolvedDirs {
  treeDir: string;
  planDir: string;
  ticketsDir: string;
  runlogDir: string;
  ompDir: string;
}

interface ResolvedFields extends ResolvedDirs {
  protectedBranches: string[];
  rootBranch: string;
  checkCommand: string;
  testCommand: string;
  maxRuns: number;
  outputFormat: string;
}

/** Seed `state` from DEFAULTS + the repo root. */
function seedResolvedState(root: string): ResolvedFields {
  return {
    treeDir: join(root, DEFAULTS.tree),
    planDir: join(root, DEFAULTS.plan),
    ticketsDir: join(root, DEFAULTS.tickets),
    runlogDir: join(root, DEFAULTS.runlog),
    ompDir: join(root, DEFAULTS.ompDir),
    protectedBranches: DEFAULTS.protectedBranches,
    rootBranch: DEFAULTS.rootBranch,
    checkCommand: DEFAULTS.checkCommand,
    testCommand: DEFAULTS.testCommand,
    maxRuns: DEFAULTS.maxRuns,
    outputFormat: DEFAULTS.outputFormat,
  };
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

  const state = seedResolvedState(root);

  if (configFile) {
    try {
      const raw = readFileSync(configFile, "utf8");
      applyPathsSection(raw, root, state);
      applyBranchesSection(raw, state);
      applyCommandsSection(raw, state);
      applyRunlogSection(raw, state);
      applyOutputSection(raw, state);
    } catch {
      // Keep defaults on parse failure
    }
  }

  return {
    available,
    configFile,
    repoRoot: root,
    treeDir: state.treeDir,
    runlogDir: state.runlogDir,
    ledgerPath: join(state.treeDir, ".ledger.jsonl"),
    planDir: state.planDir,
    ticketsDir: state.ticketsDir,
    ompDir: state.ompDir,
    receiptPath: join(state.ompDir, "receipt.toml"),
    protectedBranches: state.protectedBranches,
    rootBranch: state.rootBranch,
    checkCommand: state.checkCommand,
    testCommand: state.testCommand,
    maxRuns: state.maxRuns,
    outputFormat: state.outputFormat,
  };
}

// Env + path resolvers (`giwtOnPath`, `giwtEnv`, `resolveReceiptPath`,
// `resolvePlanDir`, `PlanSubdir`) live in `./giwt-resolve-env` and are
// re-exported below for backward-compatible single-import callers.
export {
  giwtEnv,
  giwtOnPath,
  type PlanSubdir,
  resolvePlanDir,
  resolveReceiptPath,
} from "./giwt-resolve-env";
