// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 oh-my-pi Contributors
/**
 * Standalone install helpers that carry no InstallCtx: stale extension-cache
 * invalidation and --target safety screening.
 *
 * Both were extracted from install-lib.ts to keep that module's `size-allow`
 * ceiling honest. They are grouped here because they are the only exported
 * helpers in install-lib with zero coupling to the shared install context -
 * they take plain paths and return plain values, so they are safe to test and
 * reason about in isolation.
 */
import type { Dirent } from "node:fs";
import { readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { isDirectory, lstatKind } from "./install-fs";

/**
 * Cache artifacts of omp's legacy extension transpiler, kept per profile and
 * per agent root. A running omp process holds them open; the next process
 * rebuilds them from the shipped sources, so removal IS the invalidation.
 */
export function extensionCacheFiles(cacheDir: string): string[] {
  return ["", "-wal", "-shm"].map((suffix) =>
    join(cacheDir, `legacy-pi-extension-cache.db${suffix}`),
  );
}

/**
 * Existing transpile-cache directories under an omp root: the agent root's
 * cache plus every profile's own cache dir (when present).
 */
export function findExtensionCacheDirs(ompRoot: string): string[] {
  const dirs = [join(ompRoot, "agent", "cache")];
  let profileEntries: Dirent[] = [];
  try {
    profileEntries = readdirSync(join(ompRoot, "profiles"), { withFileTypes: true });
  } catch {
    return dirs.filter(isDirectory);
  }
  for (const entry of profileEntries) {
    if (entry.isDirectory()) dirs.push(join(ompRoot, "profiles", entry.name, "cache"));
  }
  return dirs.filter(isDirectory);
}

/**
 * Delete stale transpile-cache dbs so a freshly started omp process loads the
 * just-installed extension sources instead of a cached compile of older code.
 * Best-effort and fail-open: returns the paths actually removed.
 */
export function invalidateExtensionCaches(ompRoot: string): string[] {
  const removed: string[] = [];
  for (const dir of findExtensionCacheDirs(ompRoot)) {
    for (const file of extensionCacheFiles(dir)) {
      try {
        if (lstatKind(file) !== "file") continue;
        rmSync(file, { force: true });
        removed.push(file);
      } catch {
        // cache removal must never fail the install
      }
    }
  }
  return removed;
}

/** Refuse unsafe --target values. Returns null when safe, else a reason. */
export function checkDangerousTarget(target: string, home: string): string | null {
  if (target === "" || target === "/") return "target is the filesystem root or empty";
  if (target === "/root" || target.startsWith("/root/"))
    return "target is another user's home (/root)";
  if (target === "/home" || target === "/home/") return "target is the /home directory";
  if (target.startsWith("/home/")) {
    const other = target.match(/^\/home\/([^/]+)(?:\/|$)/)?.[1];
    if (other !== undefined && other !== basename(home))
      return `target is another user's home (/home/${other}/)`;
  }
  // OS-managed read-only paths. User-writable trees are intentionally NOT
  // denied because the installer may legitimately land in them; the
  // existing symlink + realm guards already prevent cross-user escapes.
  for (const prefix of [
    "/etc",
    "/sys",
    "/proc",
    "/dev",
    "/boot",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/snap",
  ]) {
    if (target === prefix || target.startsWith(`${prefix}/`))
      return `target is under a system path (${prefix})`;
  }
  return null;
}
