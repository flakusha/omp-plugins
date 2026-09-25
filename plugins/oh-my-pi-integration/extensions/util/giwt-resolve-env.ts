// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * Env + path resolvers built on top of `resolveGiwtConfig`:
 * PATH lookup, subprocess env, receipt path, plan-subdir paths. Pure fs.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveGiwtConfig } from "./giwt-resolve";

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
