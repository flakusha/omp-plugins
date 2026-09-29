<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: check-runner subprocesses have no timeout and can hang the gate forever

**Status:** done
**Priority:** high
**Effort:** Small
**Tags:** check-gate, reliability, timeout

**Summary:**

Three check-runner Bun.spawn calls have no timeout:
- scripts/check-coverage.ts:125 — `bun test --coverage`, the longest-running gate
- scripts/check-rules-sync.ts:154 — installer --dry-run
- scripts/check-shipment.ts:152 — installer

A hung child (a wedged bun test, an installer waiting on a prompt or a filesystem lock) never resolves, so `bun run verify` and the pre-commit gate hang indefinitely with no diagnostic. There is no way to cancel: the parent has no deadline and no kill path.

**Context:**

Fix: give every spawn a bounded timeout and kill the child on expiry, failing the owning check with a message naming the gate and the elapsed budget.


Evidence: scripts/check-coverage.ts:125, scripts/check-rules-sync.ts:154, scripts/check-shipment.ts:152

**Acceptance Criteria:**

- [x] Every Bun.spawn in scripts/ carries a timeout (default 120s, overridable per check)
- [x] On timeout the child process is killed and the check exits non-zero naming the gate and the budget
- [x] A test drives a spawn against a fixture that sleeps past the timeout and asserts the kill path



- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
