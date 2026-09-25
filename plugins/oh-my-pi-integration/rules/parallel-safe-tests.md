---
name: parallel-safe-tests
description: "When writing and running tests — always consider that tests can run in parallel and allocate/deallocate the same resource; isolated 1-thread testing is fine for initial implementation, but the end goal is fast parallel tests usable in a pre-commit hook"
condition: ["^(?=[\\s\\S]*test|spec|bun test|jest|vitest|pytest|go test|describe\\(|it\\(|test\\()(?=[\\s\\S]*parallel|concurrent|race|in parallel|--threads|--workers|-j \\d)(?=[\\s\\S]*fixture|teardown|setUp|afterEach|beforeEach|temp|tmpdir|port \\d|shared (state|resource|global))"]
scope: ["text", "thinking"]
---

ALWAYS design tests for parallel execution: runners parallelize by default; tests allocate/deallocate the SAME resources unless prevented.
- UNIQUE RESOURCES PER TEST: runner tmp facility, port 0/offsets, unique DB/collection names, no shared globals — fixed-path fixtures race.
- DETERMINISTIC TEARDOWN: release in `afterEach`/`finally` — failed tests' leaks poison the rest.
- NO ORDERING DEPENDENCE: passes alone, in any order; shared state read-only or per-test.
- DOCUMENT THE RESOURCE CONTRACT: name what each test owns.
EXECUTION: 1-thread runs (`-j 1`) fine for shakeout; END GOAL: fast parallel tests (seconds) for the pre-commit hook (see the repo's verify gate); serial minute-long suites never make the hook.
TIES: gpg/ssh guard tests keep raw calls deliberately (early-flag, not parallelism); match project conventions (see repo-tooling-scoped-usage).
DON'T OVER-APPLY: integration tests against one shared external service may serialize — but must be marked/isolated, never assume exclusivity.
