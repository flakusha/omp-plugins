// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 oh-my-pi Contributors
/**
 * Profile config assembly: parse base + fragment YAML, deep-merge with the
 * fragment winning, re-serialize deterministically.
 *
 * Extracted from install-lib.ts. These are pure string-in / string-out helpers
 * with no InstallCtx, so they can be reasoned about and tested without laying
 * down a target tree.
 *
 * `InstallerError` is imported from `./install-lock` (its definition site)
 * rather than `./install-lib`: install-lib imports this module, so going back
 * through install-lib would be an import cycle.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { InstallerError } from "./install-lock";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge a profile fragment over the base config: maps merge recursively
 * (fragment wins on conflicts), any other value — scalar or list — replaces
 * the base value wholesale.
 */
export function deepMergeConfig(base: unknown, frag: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(frag)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(frag)) {
      out[key] = deepMergeConfig(base[key], value);
    }
    return out;
  }
  return frag;
}

/**
 * Assemble a complete profile config: parse base (`agent/config.yml`) and
 * fragment YAML, deep-merge (fragment wins), re-serialize deterministically
 * with line wrapping disabled so long interceptor regexes stay on one line.
 */
export function assembleProfileConfig(baseText: string, fragmentText: string): string {
  let base: unknown;
  let frag: unknown;
  try {
    base = parseYaml(baseText);
  } catch (error) {
    throw new InstallerError(`agent/config.yml is not valid YAML: ${(error as Error).message}`, 1);
  }
  try {
    frag = parseYaml(fragmentText);
  } catch (error) {
    throw new InstallerError(
      `config.fragment.yml is not valid YAML: ${(error as Error).message}`,
      1,
    );
  }
  if (base === null) base = {};
  if (frag === null) frag = {};
  if (!isPlainObject(base) || !isPlainObject(frag)) {
    throw new InstallerError("profile config base and fragment must be YAML mappings", 1);
  }
  return `${stringifyYaml(deepMergeConfig(base, frag), { lineWidth: 0 }).trimEnd()}\n`;
}
