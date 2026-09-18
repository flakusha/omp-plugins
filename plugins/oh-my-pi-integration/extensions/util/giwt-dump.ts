// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * Human-readable dump of the resolved giwt config. Split out of
 * `giwt-config.ts`; backs the `/bookkeep config` command.
 */

import { DEFAULT_CONFIG_TEMPLATE, resolveGiwtConfig } from "./giwt-resolve";

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
