// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * Low-level filesystem probes and the ownership-ledger (manifest) codec used
 * by install. Split out of `./install-lib.ts` because they are the only part
 * of the installer that reasons about what a path *is* rather than about
 * install policy: every other call site just needs "which kind of thing is
 * here" and "what do we own". `lstatKind` / `isDirectory` / `isFileFollow`
 * are exported (previously private to install-lib) because the rest of the
 * installer branches on them constantly; keeping them here means the probe
 * semantics live in one place instead of being re-derived per call site.
 */

import { createHash } from "node:crypto";
import { lstatSync, readlinkSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/** rel path -> sha256 for files we own, or the literal "dir" marker. */
export type Manifest = Map<string, string | "dir">;

export type LstatKind = "file" | "dir" | "symlink" | "other" | "missing";

export function lstatKind(p: string): LstatKind {
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return "symlink";
    if (st.isFile()) return "file";
    if (st.isDirectory()) return "dir";
    return "other";
  } catch {
    return "missing";
  }
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** stat() that follows symlinks — mirrors bash `[[ -f ... ]]`. */
export function isFileFollow(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * `realpath -m` port: canonicalize a path that may contain not-yet-existing
 * components. Symlinks in the existing prefix are resolved component-wise;
 * `..` pops the canonical prefix, so it is resolved against symlink targets.
 */
export function realpathMissing(target: string, depth = 0): string {
  if (depth > 40) throw new Error(`too many symbolic links: ${target}`);
  const abs = isAbsolute(target) ? target : resolve(target);
  const parts = abs
    .split("/")
    .slice(1)
    .filter((part) => part.length > 0);
  let resolved = "";
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      resolved = resolved.slice(0, Math.max(resolved.lastIndexOf("/"), 0));
      continue;
    }
    const cur = `${resolved}/${part}`;
    if (lstatKind(cur) !== "symlink") {
      resolved = cur;
      continue;
    }
    const link = readlinkSync(cur);
    const linkAbs = isAbsolute(link) ? link : `${resolved}/${link}`;
    resolved = realpathMissing(linkAbs, depth + 1);
    if (resolved === "/") resolved = "";
  }
  return resolved === "" ? "/" : resolved;
}

/** sha256 of a regular file; "" when missing, a symlink, or a directory. */
export async function fileSha(p: string): Promise<string> {
  if (lstatKind(p) !== "file") return "";
  try {
    const buf = await readFile(p);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Parse a manifest file body: `F <sha> <rel>` for files, `D - <rel>` for
 * directories. Malformed lines are skipped, matching `manifest_load`.
 */
export function parseManifest(text: string): Manifest {
  const manifest: Manifest = new Map();
  for (const rawLine of text.split("\n")) {
    const tokens = rawLine.trim().split(/\s+/);
    if (tokens.length < 3) continue;
    const kind = tokens[0] ?? "";
    const value = tokens[1] ?? "";
    const rel = tokens.slice(2).join(" ");
    if (rel.length === 0) continue;
    if (kind === "F") manifest.set(rel, value);
    else if (kind === "D") manifest.set(rel, "dir");
  }
  return manifest;
}

/** Serialize sorted by rel path, same `F <sha> <rel>` / `D - <rel>` format. */
export function serializeManifest(manifest: Manifest): string {
  const lines: string[] = [];
  for (const rel of [...manifest.keys()].sort()) {
    const value = manifest.get(rel);
    lines.push(value === "dir" ? `D - ${rel}` : `F ${value ?? ""} ${rel}`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
