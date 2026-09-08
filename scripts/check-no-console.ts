#!/usr/bin/env bun

// check-no-console.ts — enforce rule `use-configured-loggers`: no bare
// console.* calls in shipped TS. Biome 2.5.8 dropped noConsoleLog, so this
// repo-level gate stands in: console.log/debug/info/warn/error all bypass the
// application's configured logger (no level/format/sink/redaction), which the
// rule forbids.
// TS port of scripts/check-no-console.sh. Deliberate differences from the .sh:
//   - skips `__tests__/` trees (unit tests never ship; the .sh scanned them);
//   - skips symlinked directories (workspace node_modules links — `grep -r`
//     likewise does not follow directory symlinks);
//   - match lines are emitted in sorted path order (grep order was FS-dependent);
//   - env `OMP_CHECKS_ROOT` overrides the repo root (test fixture support).

import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.env.OMP_CHECKS_ROOT ?? join(import.meta.dir, "..");
const CONSOLE_RE = /console\.(log|debug|info|warn|error)\s*\(/;

export function isBareConsoleLine(line: string): boolean {
  return CONSOLE_RE.test(line);
}

export interface ConsoleMatch {
  path: string;
  line: number;
  text: string;
}

export function scanContent(path: string, content: string): ConsoleMatch[] {
  const matches: ConsoleMatch[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    if (CONSOLE_RE.test(text)) matches.push({ path, line: i + 1, text });
  }
  return matches;
}

export function collectTsFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (ent: Dirent, dir: string): void => {
    if (ent.isSymbolicLink()) return;
    if (ent.isDirectory()) {
      if (ent.name !== "__tests__") walk(join(dir, ent.name));
      return;
    }
    if (ent.isFile() && ent.name.endsWith(".ts")) files.push(join(dir, ent.name));
  };
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) visit(ent, dir);
  };
  walk(root);
  return files.sort();
}

export function scanPlugins(pluginsDir: string): ConsoleMatch[] {
  return collectTsFiles(pluginsDir).flatMap((file) =>
    scanContent(file, readFileSync(file, "utf8")),
  );
}

export async function main(): Promise<number> {
  const pluginsDir = join(REPO_ROOT, "plugins");
  const matches = existsSync(pluginsDir) ? scanPlugins(pluginsDir) : [];
  if (matches.length > 0) {
    console.error(
      "ERROR: bare console.* found — use the application's configured logger (rule use-configured-loggers):",
    );
    for (const m of matches) console.error(`${m.path}:${m.line}:${m.text}`);
    return 1;
  }
  console.log("==> no bare console.* in plugins (use-configured-loggers enforced)");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
