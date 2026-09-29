<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# INFRA: serialize concurrent installs with an advisory lock

**Status:** done
**Priority:** high
**Effort:** Medium
**Tags:** install, concurrency, locking

**Summary:**

Two concurrent `bun scripts/install.ts` runs against the same `--target` interleave their write sequences. install-lib.ts does atomic temp+rename per file (atomicWriteText, L433-437) but the sequence is not atomic: reconciliation (rmSync .bak / renameSync dst to .bak / cpSync, L542-546), symlink swaps (L992-994), and the manifest+lock writes (L1212-1213) each land independently. Interleaved runs can rm a .bak another run just created, or write a manifest describing a half-laid-down tree.

There is no cross-process coordination anywhere: mkdirSync calls are unguarded, and omp-plugins.lock.json is a written artifact, not a lock.

**Context:**

Fix: take an advisory lock (flock, or an O_EXCL mkdir lock with the PID+stale-reap pattern finalize already uses) on the plugin dir for the duration of the write sequence.

Acceptance criteria:
- [x] Two concurrent installs against one --target serialize; the second waits rather than interleaving
- [x] The lock is released on both success and failure paths
- [x] A lock left by a dead process is reaped, not reported as held (mirror acquireFinalizeLock's ESRCH reap in giwt/src/commands/finalize.ts:238-271)
- [x] --dry-run takes no lock
- [x] A test drives two installs concurrently against one temp target and asserts no interleaved .bak loss

Evidence: scripts/install-lib.ts:433-437, 542-546, 992-994, 1212-1213, 1400-1402

**Acceptance Criteria:**

- [x] Two concurrent installs against one --target serialize; the second waits rather than interleaving
- [x] The lock is released on both success and failure paths
- [x] A lock left by a dead process is reaped, not reported as held (mirror acquireFinalizeLock's ESRCH reap in giwt/src/commands/finalize.ts:238-271)
- [x] --dry-run takes no lock
- [x] A test drives two installs concurrently against one temp target and asserts no interleaved .bak loss
- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
