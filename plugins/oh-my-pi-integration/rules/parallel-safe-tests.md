---
name: parallel-safe-tests
description: "When writing and running tests — always consider that tests can run in parallel and allocate/deallocate the same resource; isolated 1-thread testing is fine for initial implementation, but the end goal is fast parallel tests usable in a pre-commit hook"
condition: ["test|spec|bun test|jest|vitest|pytest|go test|describe\\(|it\\(|test\\(", "parallel|concurrent|race|in parallel|--threads|--workers|-j \\d", "fixture|teardown|setUp|afterEach|beforeEach|temp|tmpdir|port \\d|shared (state|resource|global)"]
scope: ["text", "thinking"]
---

When writing and running tests, ALWAYS design for parallel execution: test runners run files/workers concurrently (bun test parallelizes files by default, jest uses workers, pytest-xdist, vitest threads) — and parallel tests will allocate and deallocate the SAME resources unless you prevent it.

THE RULE:
- UNIQUE RESOURCES PER TEST: temp files/dirs via the runner's per-test tmp facility (mktemp / bun tmpdir), ports via port 0 (kernel-assigned) or per-test offsets, DBs/collections with unique names, no shared mutable globals. A fixture written to a fixed path is a race the moment two tests run.
- DETERMINISTIC TEARDOWN: release resources in `afterEach`/`finally` so a failing test still cleans up — leaked resources from a failed test poison every later test.
- NO ORDERING DEPENDENCE: a test must pass alone and in any order; if two tests need the same state, share it read-only or build it per-test.
- DOCUMENT THE RESOURCE CONTRACT: name what each test owns so future tests don't collide.

EXECUTION STRATEGY:
- Initial implementation: isolated 1-thread testing is fine (`bun test --no-threads`, `-j 1`) to shake out logic quickly.
- END GOAL: fast parallel tests — the suite must run in seconds so it can live in the pre-commit hook (see the repo's verify gate discipline). Serial-only tests that take minutes never make it into the hook; parallel-safe tests do.

TIES: the fixture-file rule in the gpg/ssh guard tests keeps raw calls deliberately — the failure mode they catch is early-flag, not parallelism. Match the project's test conventions (see repo-tooling-scoped-usage).

DON'T OVER-APPLY: integration tests against one shared external service (a single DB, a single socket) may legitimately serialize — but then they must be marked/isolated as such, not silently assume exclusivity. The rule is: design for parallelism from the start; choose the execution mode explicitly.
