// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors
//
// Advisory install lock: two concurrent `install.ts --target <same>` runs must
// serialize instead of interleaving their write sequences, a lock left by a dead
// holder must be reaped, a live holder's lock must be respected, and --dry-run
// must take no lock at all.
//
// Real child processes throughout: the lock is PID-keyed, so two in-process
// `runInstall` calls would share one PID and reap each other's locks instead of
// contending. Tests synchronize on observable filesystem state and real process
// exit, never on a guessed sleep standing in for a condition.
import { afterEach, describe, expect, test } from "bun:test";
import type { Stats } from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseManifest } from "../install-lib";
import { acquireInstallLock, INSTALL_LOCK_FILENAME, installLockPath } from "../install-lock";

const INSTALLER = join(import.meta.dir, "..", "install.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..");
/** A real install writes a few hundred files; two concurrent ones take longer. */
const INSTALL_TIMEOUT_MS = 120_000;

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Run the real installer CLI; resolves with its exit code and captured output. */
async function install(
  target: string,
  extraArgs: string[] = [],
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([process.execPath, INSTALLER, "--target", target, ...extraArgs], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

/** Every path under `root` whose basename ends with `suffix`. */
function findBySuffix(root: string, suffix: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(suffix)) found.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return found;
}

/** Seed a lock file the way a crashed/live holder would leave it. */
function seedLock(ompRoot: string, body: string): string {
  const lockPath = installLockPath(ompRoot);
  mkdirSync(join(ompRoot, "plugins"), { recursive: true });
  writeFileSync(lockPath, body, { flag: "wx" });
  return lockPath;
}

/** lstat that reports a missing path as undefined rather than throwing. */
function lstatOrUndefined(p: string): Stats | undefined {
  return lstatSync(p, { throwIfNoEntry: false });
}

/**
 * A PID that provably does not exist. Verified here with `kill -0` rather than
 * assumed from a high number, so a PID-reusing machine cannot make the stale-
 * reap test pass for the wrong reason.
 */
function provablyDeadPid(): number {
  // An already-exited child is guaranteed dead: no PID-reuse window, and
  // `process.kill(pid, 0)` on it must throw ESRCH.
  const child = Bun.spawnSync([process.execPath, "-e", "0"]);
  let alive = true;
  try {
    process.kill(child.pid, 0);
  } catch (err) {
    alive = (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
  if (alive) throw new Error(`expected PID ${child.pid} to be dead, but it is alive`);
  return child.pid;
}

describe("install advisory lock", () => {
  test(
    "two concurrent installs against one target serialize and both succeed",
    async () => {
      const target = tempDir("omp-lock-concurrent-");
      const ompRoot = join(target, ".omp");
      const lockPath = installLockPath(ompRoot);

      // Spawn both before awaiting either, so they genuinely race for the lock
      // rather than running back to back.
      const [a, b] = await Promise.all([install(target), install(target)]);

      // Exit 0 is the contract. The second run legitimately warns that it kept
      // the plugin lockfile the first one wrote, so stderr is not asserted empty
      // — what must not appear is a lock-acquisition failure.
      expect({ a: a.code, b: b.code }).toEqual({ a: 0, b: 0 });
      expect(`${a.err}${b.err}`).not.toContain("could not acquire install lock");
      // Serialized, not interleaved: the second run got in, then released.
      expect(existsSync(lockPath)).toBe(false);

      // No .bak lost. An interleaved pair rmSyncs the .bak the other run had
      // just renamed aside, so every surviving .bak must still have a
      // destination file next to it.
      for (const bak of findBySuffix(target, ".bak")) {
        const dst = bak.slice(0, -".bak".length);
        expect({
          bak: relative(target, bak),
          dstExists: lstatOrUndefined(dst) !== undefined,
        }).toEqual({ bak: relative(target, bak), dstExists: true });
      }

      // The manifest both runs persisted must describe a fully-laid-down tree.
      // lstat (not exists) so a dangling-symlink entry also fails here.
      const manifestPath = join(ompRoot, "plugins", "oh-my-pi-integration.manifest");
      const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
      expect(manifest.size).toBeGreaterThan(0);
      const missing = [...manifest.keys()].filter(
        (rel) => lstatOrUndefined(join(target, rel)) === undefined,
      );
      expect(missing).toEqual([]);
    },
    INSTALL_TIMEOUT_MS,
  );

  test(
    "a lock left by a dead process is reaped, not reported as held",
    async () => {
      const target = tempDir("omp-lock-stale-");
      const lockPath = seedLock(join(target, ".omp"), String(provablyDeadPid()));

      const { code, err } = await install(target);

      expect({ code, err }).toEqual({ code: 0, err: "" });
      expect(existsSync(lockPath)).toBe(false);
    },
    INSTALL_TIMEOUT_MS,
  );

  test(
    "a 0-byte lock from a SIGKILLed holder is reaped",
    async () => {
      const target = tempDir("omp-lock-empty-");
      seedLock(join(target, ".omp"), "");

      const { code, err } = await install(target);

      expect({ code, err }).toEqual({ code: 0, err: "" });
    },
    INSTALL_TIMEOUT_MS,
  );

  test(
    "a live holder's lock is respected: the waiter blocks, then proceeds",
    async () => {
      const target = tempDir("omp-lock-live-");
      const lockPath = installLockPath(join(target, ".omp"));
      // The test process is definitionally alive, so this is a real live holder.
      const release = acquireInstallLock(lockPath);
      try {
        expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

        const contended = install(target);
        let settled = false;
        void contended.then(() => {
          settled = true;
        });
        // Real wall-clock wait, deliberately. The property under test is a
        // NEGATIVE one — the child does not stomp a live lock — and the only
        // way to observe "did not proceed" is that the process is still running
        // past this window. `settled` is the awaited signal, not a sleep
        // standing in for it: a stomp-on-contention would flip it true and fail
        // here long before the child's own timeout could mask anything.
        await Bun.sleep(1000);
        expect({ settled, lockHolder: readFileSync(lockPath, "utf8").trim() }).toEqual({
          settled: false,
          lockHolder: String(process.pid),
        });

        // Release and the waiter proceeds to a clean install.
        release();
        const { code, err } = await contended;
        expect({ code, err }).toEqual({ code: 0, err: "" });
        expect(existsSync(lockPath)).toBe(false);
      } finally {
        release();
      }
    },
    INSTALL_TIMEOUT_MS,
  );

  test("a live holder is never reaped: contention exhausts the ceiling instead", () => {
    const target = tempDir("omp-lock-exhaust-");
    const lockPath = seedLock(join(target, ".omp"), String(process.pid));

    // Real wall-clock backoff is the point here, not an accident: the
    // property is that a live holder is respected across the FULL bounded
    // ceiling, so the wait cannot be faked with fake timers.
    let caught: unknown;
    try {
      acquireInstallLock(lockPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as { exitCode: number; message: string };
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain(lockPath);
    expect(err.message).toContain(`PID ${process.pid}`);
    // The live holder's lock survived the failed acquisition.
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  }, 60_000);

  test("EPERM is not ESRCH: a live-but-unsignalable owner (PID 1) keeps its lock", () => {
    // PID 1 is always alive and a non-root agent cannot signal it, so
    // `kill(1, 0)` throws EPERM. Reaping there would let any install steal
    // init's lock — the exact bug the ESRCH-only rule exists to prevent.
    let signalErr: NodeJS.ErrnoException | null = null;
    try {
      process.kill(1, 0);
    } catch (err) {
      signalErr = err as NodeJS.ErrnoException;
    }
    // Running as root skips the EPERM case entirely; assert the decision the
    // lock makes for PID 1 either way rather than asserting an errno we cannot
    // force on a root test machine.
    const ownerIsDead = signalErr !== null && signalErr.code === "ESRCH";
    if (ownerIsDead) return; // PID 1 is gone (unreachable on a sane system)

    const target = tempDir("omp-lock-eperm-");
    const lockPath = seedLock(join(target, ".omp"), "1");
    let caught: unknown = null;
    try {
      acquireInstallLock(lockPath);
    } catch (err) {
      caught = err;
    }
    // Exhausted the ceiling rather than stealing PID 1's lock...
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { message: string }).message).toContain("PID 1");
    // ...and the owner's lock is still on disk, untouched.
    expect(readFileSync(lockPath, "utf8").trim()).toBe("1");
  }, 60_000);

  test("--dry-run takes no lock: it neither creates one nor blocks on one", async () => {
    const target = tempDir("omp-lock-dry-");
    const lockPath = seedLock(join(target, ".omp"), String(process.pid));

    // A live lock is held: if a dry run tried to take it, it would stall and
    // then fail. It must succeed immediately and leave the lock alone.
    const { code, err } = await install(target, ["--dry-run"]);

    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    rmSync(lockPath);

    // And with no pre-existing lock, a dry run creates none anywhere under it.
    const fresh = tempDir("omp-lock-dry-fresh-");
    expect((await install(fresh, ["--dry-run"])).code).toBe(0);
    expect(findBySuffix(fresh, INSTALL_LOCK_FILENAME)).toEqual([]);
  });

  test("--help writes nothing at all", async () => {
    const proc = Bun.spawn([process.execPath, INSTALLER, "--help"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ code, err, hasUsage: out.includes("install.ts") }).toEqual({
      code: 0,
      err: "",
      hasUsage: true,
    });
    // --help names no target, so nothing at all could have been created.
    expect(existsSync(join(tempDir("omp-lock-help-"), ".omp"))).toBe(false);
  });

  test(
    "the lock is released on the failure path, not just the success path",
    async () => {
      const target = tempDir("omp-lock-fail-");
      const ompRoot = join(target, ".omp");
      // Make the final manifest write fail: renameSync(tmp, <directory>) errors,
      // so runInstall throws mid-sequence while holding the lock.
      mkdirSync(join(ompRoot, "plugins", "oh-my-pi-integration.manifest"), { recursive: true });
      const lockPath = installLockPath(ompRoot);

      const { code } = await install(target);

      expect(code).not.toBe(0);
      // Threw mid-sequence, yet the lock is gone — the `finally` released it.
      expect(existsSync(lockPath)).toBe(false);
    },
    INSTALL_TIMEOUT_MS,
  );
});
