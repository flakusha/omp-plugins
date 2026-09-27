<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: find-work STATUS_DONE_RE misses vocabulary Wontfix and Postponed, leaking them into the open roster

**Status:** ✅ Done
**Priority:** high
**Effort:** Small
**Tags:** roster

## Summary

## Summary

`/find-work` treats the plan-vocabulary terminal states `Wontfix` and `Postponed` as **open work** and offers them as pickable tickets, because `STATUS_DONE_RE` cannot match either spelling.

## Problem

`STATUS_DONE_RE` at `plugins/oh-my-pi-integration/extensions/commands/find-work/keywords.ts:92-93`:

```ts
export const STATUS_DONE_RE =
  /^\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*|\[[^\]]*\]\s*|~~?\s*)*(done|fixed|complete[ds]?|closed|shipped|applied|finished|resolved|won'?t\s+(?:fix|do)|not-a-bug|duplicate(?:-of)?[\w.-]*)\b/iu;
```

Two independent gaps:

1. **`Wontfix`** — the done-class alternative is `won'?t\s+(?:fix|do)`, which requires `\s+` (whitespace) between the verb and `fix`. The plan vocabulary term is the single word `Wontfix` (no space, no apostrophe), so the branch can never match it.
2. **`Postponed`** — absent from the done-class entirely.

`planFileTicket()` (`roster-receipt-plan.ts:109-112`) excludes a ticket only when some status line matches this regex; anything unmatched is surfaced as open work.

## Reproduction

Running the regex above verbatim against the six plan-vocabulary terms:

```
status         done-re   roster verdict
"Not Started"  false     INCLUDED as open work
"In Progress"  false     INCLUDED as open work
"Blocked"      false     INCLUDED as open work
"Done"         true      EXCLUDED
"Wontfix"      false     INCLUDED as open work
"Postponed"    false     INCLUDED as open work
```

So a ticket deliberately parked as `Wontfix` or `Postponed` is offered by `/find-work` as actionable work, and an agent picking from the roster will act on it.

## Why this matters

This gets worse as repos adopt the vocabulary. giwt is actively normalizing legacy statuses to the 6-term set (`TASK-giwt-plan-validate-status-vocab-gate`, landed `d40da74`), so more tickets will land on exactly `Wontfix` and `Postponed` over time. The regex predates the vocabulary and has no coverage for two of its six terms.

`Not Started` / `In Progress` / `Blocked` matching as open is correct. `Done` being excluded is correct. The defect is confined to the two terms that mean *stop working on this*.

## Acceptance

- [x] `STATUS_DONE_RE` matches `Wontfix` and `Postponed` (bare spellings, with or without the emoji prefixes the vocabulary is written with). — done-class loosened to `won'?t\s*(?:fix|do)` + `postponed`; verified bare + ✅/❌ prefixed.
- [x] `Not Started`, `In Progress` and `Blocked` still match as **open** — no regression into the done-class.
- [x] Table-driven test over all six vocabulary terms lives in `find-work.test.ts`, asserting the include/exclude verdict per term. — `STATUS_DONE_RE giwt status vocabulary` describe.
- [x] giwt `normalizeStatus` and this regex agree on the same six terms — giwt's matrix buckets Wontfix/Postponed into non-open columns (`other`/`cancelled`, feature-matrix.ts STATUS_COLUMNS) and canonicalizes cancelled/dropped → Wontfix; omp now treats them terminal too.

## Related

- `BUG-find-work-closed-epic-reconciliation-stubs-leak-into-roster` (Done) — same roster, opposite failure: done tickets leaking in. This ticket is terminal-state tickets leaking in.
- `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` (giwt, Done) — the cross-repo contract that motivated mirroring the done-class; it covers dual-status files, not vocabulary coverage.

## Acceptance Criteria

- [x] Implementation complete
- [x] Tests passing (`bun run verify` green, 670 tests)
- [x] Documentation updated (ticket file; test comments document the cross-tool contract)
