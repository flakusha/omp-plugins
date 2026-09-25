---
name: docs-no-volatile-metrics
description: "Do not write volatile metrics or verification snapshots (test counts, coverage %, line counts, timings) into documents — actively maintained code makes them stale within days"
condition: ["^(?=[\\s\\S]*\\d+\\s+tests? (pass|passed|fail|failed|green))(?=[\\s\\S]*\\d+/\\d+\\s+tests?)(?=[\\s\\S]*coverage\\s+\\d+%)(?=[\\s\\S]*\\d+\\s+lines of (code|source))(?=[\\s\\S]*\\d+\\s+(files|modules?)\\s+(changed|written|added|modified))(?=[\\s\\S]*\\d+\\s*ms(\\s|$))(?=[\\s\\S]*benchmark\\s*[:=]?\\s*\\d+)(?=[\\s\\S]*(all|every|all the)\\s+tests?\\s+(pass|green))"]
scope: ["tool:write(**/*.md)", "tool:edit(**/*.md)"]
---

Do NOT put volatile metrics or verification snapshots into documents — test counts, coverage %, line counts, file tallies, benchmark timings, "all tests green": stale within days, and a stale doc misleads and erodes trust.

Write durable facts: intent, invariants, behavior, interfaces, mechanisms. For verification, reference the proving command (`bun run verify`, CI gate) — never its current output. A genuinely load-bearing number is stated as test-asserted, mechanism-level.

✗ "14/14 tests pass" → ✓ "Run `bun run verify` before merging."
