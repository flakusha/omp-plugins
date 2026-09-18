// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * Bare-minimum TOML extraction helpers for the giwt config loader.
 * Split out of `giwt-config.ts`; no strict TOML spec — only the shapes
 * giwt.toml actually uses (quoted strings, arrays, ints, bare values).
 */

/**
 * Parse a simple TOML key = "value" from a section's body text.
 * Bare-minimum parser: handles quoted strings and bare values.
 */
export function tomlValue(section: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m");
  const m = re.exec(section);
  return m?.[1];
}

/** Parse a TOML array value: `["a", "b"]` → ["a", "b"]. */
export function tomlArray(section: string, key: string): string[] | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m");
  const m = re.exec(section);
  if (!m?.[1]) return undefined;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/** Parse a TOML integer value. */
export function tomlInt(section: string, key: string): number | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, "m");
  const m = re.exec(section);
  return m?.[1] ? Number(m[1]) : undefined;
}

/** Parse a TOML bare (unquoted) string value. */
export function tomlBare(section: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*([^\\s\\n]+)`, "m");
  const m = re.exec(section);
  return m?.[1]?.replace(/^"(.*)"$/, "$1");
}

/**
 * Extract a named section from a TOML string.
 * Returns the raw section body, or "" when absent.
 */
export function tomlSection(raw: string, name: string): string {
  const header = `[${name}]`;
  const start = raw.indexOf(header);
  if (start < 0) return "";
  const rest = raw.slice(start + header.length);
  const nextSection = rest.search(/^\s*\[/m);
  return nextSection >= 0 ? rest.slice(0, nextSection) : rest;
}
