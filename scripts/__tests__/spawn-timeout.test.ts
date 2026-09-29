import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatTimeoutMessage, spawnWithTimeout } from "../spawn-timeout";

// The fixture sleeps 5s and the deadline is a fraction of that, so a correct
// kill returns in ~250ms while a broken one blows the per-test budget instead
// of hanging the suite.
const BUDGET_MS = 250;
// The tree test's child boots bun, spawns a second bun, and flushes a pid file
// before the kill lands. Measured at 4-7ms unloaded and under 40 CPU burners, so
// 500ms keeps a ~70x margin for a loaded parallel runner while staying cheap.
const TREE_BUDGET_MS = 500;
const SLEEPER = [process.execPath, "-e", "setTimeout(() => {}, 5000)"];
// Signal 0 probes liveness without delivering: ESRCH proves the pid is gone,
// EPERM would mean it lives but we may not signal it.
function errnoOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code;
  }
}

describe("formatTimeoutMessage", () => {
  test("names the gate and the budget", () => {
    const message = formatTimeoutMessage("check-shipment (installer)", 120_000);
    expect(message).toContain("check-shipment (installer)");
    expect(message).toContain("120000ms");
  });

  test("renders a non-default budget verbatim", () => {
    expect(formatTimeoutMessage("unit", 250)).toBe(
      "gate 'unit' exceeded its 250ms budget — child process killed (raise the budget only with cause)",
    );
  });
});

describe("spawnWithTimeout", () => {
  test("returns the child's exit code and output when it finishes in time", async () => {
    const run = await spawnWithTimeout(
      [process.execPath, "-e", "process.stdout.write('done'); process.exit(3)"],
      { stdout: "pipe", stderr: "pipe", gate: "fast-child", timeoutMs: 10_000 },
    );
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.code).toBe(3);
      expect(run.stdout).toBe("done");
    }
  }, 15_000);

  // These three are pure I/O waits on independent children with disjoint
  // resources, so they run as one concurrent batch: sequential execution would
  // spend ~1.2s serialising sleeps the event loop could overlap. Their internal
  // ordering matters (a pid read after its kill), so each stays sequential
  // within its own await chain.
  test("bounds, kills, and reaps concurrent children", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spawn-timeout-"));
    const pidFile = join(dir, "grandchild.pid");
    let grandchild = 0;
    try {
      // The tree child spawns a grandchild that outlives it, handing its pid
      // back through a file. A bare Subprocess.kill() orphans that grandchild
      // (verified: it survives), so asserting it is gone pins the group-kill design.
      //
      // Resource contract: this test owns one mkdtemp dir and the three processes
      // in its trees; nothing else in the suite touches any of them. Teardown
      // kills survivors, so a failed assertion cannot leak into the next test.
      const [hung, defaulted, tree] = await Promise.all([
        spawnWithTimeout(SLEEPER, {
          stdout: "pipe",
          stderr: "pipe",
          gate: "hung-child",
          timeoutMs: BUDGET_MS,
        }),
        // Omitting timeoutMs must not hang: a child that exits immediately still
        // clears the shared default deadline and reports its own code.
        spawnWithTimeout([process.execPath, "-e", "process.exit(0)"], {
          stdout: "pipe",
          stderr: "pipe",
          gate: "defaulted",
        }),
        spawnWithTimeout(
          [
            process.execPath,
            "-e",
            `require("node:fs").writeFileSync(process.argv[1], String(Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 5000)'], { stdout: 'inherit', stderr: 'inherit' }).pid)); setTimeout(() => {}, 5000)`,
            pidFile,
          ],
          { stdout: "pipe", stderr: "pipe", gate: "tree", timeoutMs: TREE_BUDGET_MS },
        ),
      ]);

      // One settle window for both reaps, issued once instead of twice: the
      // probes are independent, so serialising them just adds latency.
      await Bun.sleep(50);

      // Hung child: reported as a timeout, killed on the deadline, and gone.
      expect(hung.ok).toBe(false);
      expect(hung.elapsedMs).toBeLessThan(5_000);
      expect(formatTimeoutMessage(hung.gate, hung.timeoutMs)).toContain(hung.gate);
      // SIGKILL is synchronous, but give the scheduler a moment before probing —
      // asserting in the same tick assumes a zero-width reap window.
      // kill(pid, 0) probes liveness without signalling: ESRCH proves the child
      // was reaped, not that it happened to exit just after the deadline.
      expect(errnoOf(() => process.kill(hung.pid, 0))).toBe("ESRCH");

      expect(defaulted.ok).toBe(true);

      expect(tree.ok).toBe(false);
      if (existsSync(pidFile)) grandchild = Number(readFileSync(pidFile, "utf8"));
      expect(grandchild).toBeGreaterThan(0);
      expect(errnoOf(() => process.kill(grandchild, 0))).toBe("ESRCH");
    } finally {
      if (grandchild > 0 && errnoOf(() => process.kill(grandchild, 0)) !== "ESRCH") {
        process.kill(grandchild, "SIGKILL");
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
