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
 *
 * Implementation lives in `giwt-toml.ts` (bare TOML helpers),
 * `giwt-resolve.ts` (resolution + path/env helpers), and `giwt-dump.ts`
 * (human-readable dump); this file is the stable import surface.
 */

export { dumpGiwtConfig } from "./giwt-dump";
export type { GiwtConfig, PlanSubdir } from "./giwt-resolve";
export {
  CONFIG_FILENAMES,
  DEFAULT_CONFIG_TEMPLATE,
  giwtEnv,
  giwtOnPath,
  resolveGiwtConfig,
  resolvePlanDir,
  resolveReceiptPath,
} from "./giwt-resolve";
