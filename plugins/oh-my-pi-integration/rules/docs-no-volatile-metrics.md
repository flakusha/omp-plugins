---
name: docs-no-volatile-metrics
description: "Do not write volatile metrics or verification snapshots (test counts, coverage %, line counts, timings) into documents — actively maintained code makes them stale within days"
condition: ["(?=[\\s\\S]*\\d+\\s+tests? (pass|passed|fail|failed|green))(?=[\\s\\S]*\\d+/\\d+\\s+tests?)(?=[\\s\\S]*coverage\\s+\\d+%)(?=[\\s\\S]*\\d+\\s+lines of (code|source))(?=[\\s\\S]*\\d+\\s+(files|modules?)\\s+(changed|written|added|modified))(?=[\\s\\S]*\\d+\\s*ms(\\s|$))(?=[\\s\\S]*benchmark\\s*[:=]?\\s*\\d+)(?=[\\s\\S]*(all|every|all the)\\s+tests?\\s+(pass|green))"]
scope: ["tool:write(**/*.md)", "tool:edit(**/*.md)"]
---

Do NOT put volatile metrics or verification snapshots into documents: test counts ("14/14 tests pass"), coverage percentages ("coverage 87%"), line counts ("1,200 lines"), "N files changed" tallies, benchmark timings, or "all tests green" statements of current state. Actively maintained code changes daily — these claims are stale within days, and a stale doc is worse than no doc: it misleads and erodes trust in the whole document.

Write durable facts instead:
- Intent, invariants, behavior, interfaces, and mechanisms — what the code does and why, not how it measured yesterday.
- For verification, reference the command that proves it (`bun run verify`, CI gate) as the living source of truth — do not snapshot its current output.
- If a number is genuinely load-bearing (a documented invariant, e.g. "the guard matches N failure patterns"), say it is asserted by tests and keep it mechanism-level; never present a passing-run snapshot as a property of the code.

Examples:
- ✗ "14/14 tests pass" → ✓ "Run `bun run verify` (lint + typecheck + tests) before merging."
- ✗ "Coverage is 87%" → ✓ "Coverage is enforced by the CI gate; `bun run test:coverage` reports it."
- ✗ "Suite green as of 2026-08-14" → ✓ "The suite is green in CI on every commit."
