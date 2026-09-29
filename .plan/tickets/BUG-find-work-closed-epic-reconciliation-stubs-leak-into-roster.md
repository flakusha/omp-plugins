<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: find-work: closed EPIC reconciliation stubs leak into roster

**Status:** ✅ Done
**Priority:** high
**Effort:** Small

## Summary

## Problem

Closed `.plan/tickets/EPIC-XXX.md` reconciliation stubs surface as open work items in `/find-work`, despite the tickets being correctly marked closed in their files.

## Reproduction

1. Create any ticket file with two `**Status**` lines — the legacy reconciler output and a follow-up marker.
2. Example from loop-lore `.plan/tickets/EPIC-030.md`:
   ```
   **Status:** Not Started → closed (duplicate)
   ...
   **Status**: duplicate-of-epic-llm-queue
   ```
3. Run `/find-work` — the ticket appears in the open roster.

## Root cause

`plugins/oh-my-pi-integration/extensions/commands/find-work/roster.ts:planFileTicket()` uses:

```ts
const status = lines.find((line) => STATUS_LINE_RE.test(line));
const statusValue = status ? (STATUS_LINE_RE.exec(status)?.[1] ?? "") : "";
if (STATUS_DONE_RE.test(statusValue)) return null;
```

`Array.find` returns the FIRST matching status line. When a ticket has both
``**Status:**`` (legacy reconciler) and ``**Status**:`` (modern
format), the legacy line wins.

- `"Not Started → closed (duplicate)"` does not start with a done keyword, so `STATUS_DONE_RE` returns false.
- `"duplicate-of-epic-llm-queue"` would match `STATUS_DONE_RE` (regex contains `duplicate(?:-of)?[\w.-]*`).

Result: ticket leaks into `/find-work` despite the second status line clearly marking it done.

## Evidence

Verified against live loop-lore state on 2026-09-23:

| File | Status line 1 | Status line 2 | Skipped? |
|---|---|---|---|
| `EPIC-030.md` | Not Started → closed (duplicate) | duplicate-of-epic-llm-queue | NO (leaks) |
| `EPIC-058.md` | Not Started → closed (duplicate) | duplicate-of-epic-locations | NO (leaks) |
| `EPIC-2026-11.md` | (similar) | duplicate-of-epic-frontend-admin | NO (leaks) |
| `EPIC-2026-23.md` | In Progress | (real work, not duplicate) | correctly leaks |

28 reconciliation stubs closed by commits `c30c03a3b`, `350065abc`, `41f7e5789` (all 2026-09-23) all leak — the patching did work in the file content but is invisible to `/find-work`.

## Probe (ran locally, output below)

```json
{"input":"**Status:** Not Started → closed (duplicate)","value":"Not Started → closed (duplicate)","done":false,"expected":false,"ok":true}
{"input":"**Status**: duplicate-of-epic-llm-queue","value":"duplicate-of-epic-llm-queue","done":true,"expected":true,"ok":true}
{"input":"**Status:** closed","value":"closed","done":true,"expected":true,"ok":true}
{"input":"**Status:** In Progress","value":"In Progress","done":false,"expected":false,"ok":true}
--- roster.ts simulation ---
{"found":"**Status:** Not Started → closed (duplicate)","val":"Not Started → closed (duplicate)","skippedByDone":false,"leaksToFindWork":true}
```

## Proposed fix

Iterate ALL status lines; skip the ticket if ANY satisfies `STATUS_DONE_RE`. From the same probe with the proposed fix:

```json
{"statusValues":["Not Started → closed (duplicate)","duplicate-of-epic-llm-queue"],"anyDone":true,"leaksToFindWork":true}
```

Wait — the proposed fix still flags as done (which is correct: ticket SHOULD be skipped). The fix logic:

```ts
const statusValues = lines
  .filter((line) => STATUS_LINE_RE.test(line))
  .map((line) => STATUS_LINE_RE.exec(line)?.[1] ?? "");
if (statusValues.some((v) => STATUS_DONE_RE.test(v))) return null;
```

When ANY status line says done, the ticket is correctly skipped. The fix makes the probe output `leaksToFindWork: false`.

## Cross-tool contract

Giwt's `parseTicketFile` (separate parser, same input) correctly classifies these as `done` via `normalizeStatus("Not Started → closed (duplicate)") === "done"`. Giwt and omp-plugins disagree on what the same input means — giwt treats it as done, omp-plugins treats it as open.

## Acceptance

- A `.plan/tickets/X.md` with two status lines (one legacy, one `duplicate-of-…`) is NOT surfaced by `/find-work`.
- Existing tests in `find-work.test.ts` continue to pass; add regression test for the two-status-line case.
- Single-status-line behavior unchanged.

## Related

- Loop-lore reconciliation commits: `c30c03a3b`, `350065abc`, `41f7e5789`
- Giwt counterpart parser: `giwt/src/tickets/sync-index.ts:parseTicketFile` — currently correct; cross-link if a fix here should mirror to giwt or vice versa.


**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
  Behavior fix; no doc surface changed (roster skip rule already documented).
