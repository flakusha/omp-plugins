<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: surface giwt run records in find-work discovery

**Status:** ⬜ Not Started
**Priority:** Medium
**Effort:** Medium

## Summary

giwt writes structured run records under <repo>/.tmp/giwt/runs/ (meta.json/events.jsonl, abnormal-exit signal). Consider teaching /find-work (extensions/commands/find-work.ts) to list recent abnormal runs as candidate work items alongside receipt ledger, .plan docs, gh and git-issue sources.

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
