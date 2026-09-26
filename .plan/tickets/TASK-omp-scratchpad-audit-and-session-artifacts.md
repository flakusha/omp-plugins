<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 omp-plugins Contributors -->

# omp-plugins: scratchpad audit + receipt session-artifacts line

**Status:** ✅ Done (/bookkeep scratch + bare-audit cross-ref in bookkeep/scratch.ts; receipt session_artifacts end-to-end via util/tmp-write-tracker.ts)
**Priority:** Medium
**Effort:** Medium
**Type:** Task

## Summary
Two consumer-side hardening changes that pair with the loop-lore + giwt scratchpad tooling tickets:
1. expose a turn-summarizable /bookkeep scratch (or audit --scratch) command that runs giwt clean --dry-run + giwt doctor's scratchpad check, then prints .tmp bytes / orphan count / oldest artifact / top-5 largest globs;
2. extend the project's .omp/receipt.toml with a per-session session_artifacts = [..] array listing every path written under .tmp in that session - populated by the same hook that already writes the [[job]] / [[issue]] entries (extensions/index.ts:50 carry step, extensions/receipt/receipt-carry.ts).

Landed (2026-09-26), with one verified divergence: giwt has neither `clean --dry-run` nor a doctor scratchpad check today (giwt G-3/G-4 pending) — and bare `giwt clean` removes worktrees — so `/bookkeep scratch` computes the summary pure-fs (bookkeep/scratch.ts: total bytes, file count, orphan count via basename cross-ref over .plan/docs/src, oldest artifact, top-5 globs; no subprocess). The receipt side is per spec: `parseReceipt` recognizes top-level `session_artifacts = [...]`, `carry` rewrites it each turn from `drainTmpWrites()` (util/tmp-write-tracker.ts wraps fs write/rename + Bun.write, record-then-delegate, .tmp-rooted paths only), and `renderFooter` appends a capped `artifacts: N` line that is dropped first when the footer would exceed RECEIPT_MAX_LINES.

## Acceptance Criteria
1. [x] /bookkeep scratch subcommand registered (actions.ts, completions.ts); pure-fs summary table — adapted to not exec giwt clean/doctor (divergence recorded in scratch.ts header).
2. [x] receipt-doc.ts parses `session_artifacts`, entry blocks excluded; renderFooter surfaces one-line `artifacts: N` within the line cap.
3. [x] index.ts installs the tracker (skipped under PI_RECEIPT_DISABLE=1); before_agent_start drains writes into carryReceipt; receipt.test.ts end-to-end fixture (3 tracked .tmp writes → session_artifacts in file).
4. [x] Summary fields defined so they agree with giwt doctor once G-3/G-4 land (same definitions: bytes, orphan count, oldest artifact, top globs).
5. [x] Citation cross-references the loop-lore evidence file and the matching giwt tickets (G-3 giwt clean, G-4 giwt doctor scratchpad check) via the divergence note above.

## Cross-references
- /home/flak/git-ai/loop-lore/tree/ticket-filing-batch-2026-09-26/.tmp/scratchpad-pattern-analysis-2026-09-26.md section 4.2 (O-1, O-2), section 2 P-05, P-13.
- extensions/commands/bookkeep/{scratch,actions,prompts,completions}.ts; extensions/receipt/{receipt,receipt-carry,receipt-doc}.ts; extensions/util/tmp-write-tracker.ts; extensions/index.ts; extensions/__tests__/{bookkeep,receipt}.test.ts.

git issue: <appended by giwt sync>

git issue: e39bd29