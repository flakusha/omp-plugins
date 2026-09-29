<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: verify runs the full test suite twice

**Status:** done
**Priority:** high
**Effort:** Small
**Tags:** check-gate, performance, redundant-work

**Summary:**

The verify script (package.json:48) chains `bun run test && bun run check:coverage`. Both run the entire suite:
- `bun run test` = `bun test`
- `check:coverage` (scripts/check-coverage.ts:125-135) spawns `bun test --coverage --coverage-reporter=lcov` over the whole repo

So every `bun run verify` and every pre-commit-adjacent run pays the full suite twice, once without coverage and once with. The coverage run is strictly more informative than the plain run — it executes the same tests and additionally emits lcov. The plain `bun run test` step is redundant work.

**Context:**

Fix: drop the redundant plain test step from verify, keeping the coverage run as the single test execution (it already fails the gate on a non-zero exit, check-coverage.ts:141-147).


Evidence: package.json:48, scripts/check-coverage.ts:125-147

**Acceptance Criteria:**

- [x] `bun run verify` executes the test suite exactly once
- [x] A failing test still fails verify with a non-zero exit
- [x] `bun run test` remains available standalone for a fast inner loop
- [x] README/docs referencing the verify step list are updated



- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
