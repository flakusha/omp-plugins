// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors
//
// Cross-process advisory install lock, split out of install-lib.ts purely so
// that file fits its 1500-line budget. `InstallerError` is DEFINED here (and
// re-exported by install-lib.ts) rather than imported from it, because the lock
// throws it and a back-import would be a module cycle.
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

/** Error carrying the process exit code install.sh would have used. */
export class InstallerError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "InstallerError";
    this.exitCode = exitCode;
  }
}

// Lock lives in TARGET/.omp/plugins/ next to the manifest: OUTSIDE the installed
// plugin package (check-shipment.ts walks that tree for stray files) and never
// a manifest entry, so it is neither shipped nor reconciled.
export const INSTALL_LOCK_FILENAME = ".omp-plugins.install.lock";
// 300 attempts x 25ms = ~7.5s ceiling. A full install writes a few hundred
// files; a concurrent run must queue behind it, not fail, so the ceiling has to
// outlast a slow first install without hanging forever.
const LOCK_ATTEMPTS = 300;
const LOCK_BACKOFF_MS = 25;

/** Absolute path of the advisory install lock for an omp root. */
export function installLockPath(ompRoot: string): string {
  return join(ompRoot, "plugins", INSTALL_LOCK_FILENAME);
}

/**
 * Acquire the cross-process advisory install lock at `lockPath`; returns a
 * release function the caller MUST invoke in a finally block.
 *
 * Per-file writes are atomic (temp+rename) but the install SEQUENCE is not:
 * reconciliation (rmSync .bak / renameSync dst->.bak / cpSync), the symlink
 * swaps and the manifest+plugin-lockfile writes each land independently, so two
 * concurrent installs against one --target interleave — one can rm a .bak the
 * other just created, or persist a manifest describing a half-laid-down tree.
 *
 * Primitive mirrors giwt's `acquireFinalizeLock`: atomic O_CREAT|O_EXCL via
 * `openSync(path, "wx")` with the PID as the body, so a lock left by a crashed
 * holder is detected via `kill -0` and reaped. Contended acquisition waits with
 * a bounded backoff so the second install serializes behind the first.
 *
 * Exported for `scripts/__tests__/install-lock.test.ts`: the lock is PID-keyed,
 * so a test cannot exercise contention with two in-process acquires (they would
 * share one PID and reap each other) — it needs a real holder process.
 */
export function acquireInstallLock(lockPath: string): () => void {
  const myPid = process.pid;
  mkdirSync(dirname(lockPath), { recursive: true });

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, String(myPid));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };

  // True when the lock is reapable: unparseable (0-byte file left by a prior
  // holder SIGKILLed between create and PID write) or a process provably gone
  // (ESRCH). EPERM — a non-root agent cannot signal PID 1 — means the owner
  // is ALIVE, so its lock is respected.
  const lockOwnerIsGone = (lockRaw: string): boolean => {
    const ownerPid = Number.parseInt(lockRaw, 10);
    if (!Number.isFinite(ownerPid)) return true;
    if (ownerPid === myPid) return false;
    try {
      process.kill(ownerPid, 0);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ESRCH";
    }
  };

  const reapStale = (): boolean => {
    let lockRaw: string;
    try {
      lockRaw = readFileSync(lockPath, "utf8").trim();
    } catch {
      return false;
    }
    if (!lockOwnerIsGone(lockRaw)) return false;
    try {
      unlinkSync(lockPath);
    } catch {
      /* best-effort */
    }
    return tryCreate();
  };

  const release = (): void => {
    try {
      unlinkSync(lockPath);
    } catch {
      /* best-effort */
    }
  };

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    if (tryCreate()) return release;
    if (reapStale()) return release;
    Bun.sleepSync(LOCK_BACKOFF_MS);
  }
  let holder = "unknown";
  try {
    holder = readFileSync(lockPath, "utf8").trim() || "unreadable";
  } catch {
    /* best-effort */
  }
  throw new InstallerError(
    `could not acquire install lock ${lockPath} after ${LOCK_ATTEMPTS * LOCK_BACKOFF_MS}ms; held by PID ${holder}`,
    1,
  );
}
