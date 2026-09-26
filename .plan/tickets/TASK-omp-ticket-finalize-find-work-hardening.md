<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 omp-plugins Contributors -->

# omp-plugins: /ticket status validate, /finalize name-read, find-work hardening

**Status:** ✅ Done (STATUS_VOCAB advisory in ticket.ts, failedGates name-read step in finalize.ts, --state=open + 30d staleness in find-work)
**Priority:** Medium
**Effort:** Medium
**Type:** Task

## Summary
Five consumer-side hardening changes that pair with the loop-lore + giwt scratchpad tooling tickets:
- /bookkeep audit learns to flag both directions of broken artifact linkage (.plan refers to missing .tmp artifact; .tmp artifact is referenced by nothing).
- /ticket validates **Status:** against the closed enum before writing the file.
- /finalize prompt changes to instruct the agent to read the failing gate by name from the run record's check.log instead of re-running blind.
- find-work passes --state=open to giwt issues (depends on giwt's TASK-giwt-issues-state-filter-flag.md) and drops the in-parser bracket filter.
- find-work roster suppresses tickets whose .tmp analysis artifact is older than N=30 days or whose target code no longer matches the artifact's recorded commit.

Landed (2026-09-26):
1. `/bookkeep audit` (bare) → `buildScratchAuditPrompt` (bookkeep/prompts.ts): bidirectional .tmp↔.plan cross-ref probe (ls -l for referenced .tmp paths; grep -rlF basename over .plan/, docs/, src/ for orphans).
2. `/ticket`: `STATUS_VOCAB` in ticket/parse.ts (open|in_progress|blocked|done|dropped, provisional); `findStatusAdvisory` emits a fail-open `[status-vocab advisory]` warning then proceeds — giwt has not ratified the enum, so the ticket's own fallback clause applies.
3. `/finalize`: `detectFinalizeEnv` exposes `lastRunId` (newest `.tmp/giwt/runs/` dir); `buildGiwtFinalizePrompt` gained a post-merge step reading `meta.json → outcome.failedGates` (verified giwt behavior; check.log FAIL-grep is the documented fallback) — not the ticket's original `^FAIL` grep, because check.log is a raw capture.
4. find-work: omp calls `git-issue ls` directly (not `giwt issues`), and git-issue already supports `--state` — fetch.ts now execs `["ls", "--state=open"]` and `parseGitIssueList` no longer drops closed lines (bracket strip kept). No `[giwt-state-filter advisory]` needed; the dependency exists at the git-issue layer.
5. find-work staleness: `ARTIFACT_STALE_DAYS = 30` + `VERIFIED_AT_RE` in keywords.ts; planTickets and giwtRunTickets suppress artifacts older than 30d, preferring a `verified-at:` marker over mtime. The sha-vs-HEAD check stays deferred until giwt ships the verified-at convention (roster builders are pure-fs).

## Acceptance Criteria
1. [x] /bookkeep audit (without <target>) emits the .tmp-vs-.plan cross-reference prompt (both directions; selfreview3.sh probe shape).
2. [x] /ticket STATUS_VOCAB + fail-open [status-vocab advisory] with offending line + suggestion.
3. [x] /finalize name-read step via meta.json failedGates (+ lastRunId env probe; check.log fallback).
4. [x] Explicit open-state request at the source; in-parser bracket closed-filter removed (adapted: git-issue ls --state=open, not giwt issues).
5. [x] Staleness suppression by mtime/verified-at marker (sha check deferred with giwt's convention, per the ticket's fallback clause).
6. [x] Cross-references preserved below.

## Cross-references
- /home/flak/git-ai/loop-lore/tree/ticket-filing-batch-2026-09-26/.tmp/scratchpad-pattern-analysis-2026-09-26.md section 4.2 (O-3..O-7), section 3 D-02, section 2 P-05/P-06/P-08/P-13.
- extensions/commands/bookkeep/{actions,prompts}.ts (bare audit), extensions/commands/ticket.ts + ticket/parse.ts (STATUS_VOCAB), extensions/commands/finalize.ts (lastRunId + failedGates step), extensions/commands/find-work/{fetch,roster-external,roster-receipt-plan,keywords}.ts (state filter + staleness).

git issue: <appended by giwt sync>

git issue: dd159ba