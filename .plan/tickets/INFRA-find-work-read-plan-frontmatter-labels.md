<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# INFRA: /find-work reads YAML frontmatter `labels` from .plan/* tickets and epics

**Labels:** find-work, labels
**Status:** ⬜ Not Started
**Priority:** Medium
**Effort:** Medium

## Summary

`/find-work` read `labels` only from `gh issue list --json ...labels`; `.plan/`
tickets and epics surfaced as `task`/`P3`/dir-domain regardless of their
declared labels. Extended `planTickets` to resolve labels per artifact —
YAML frontmatter `labels:` (flow/bare/block forms), header `**Labels:**`, or
header `**Tags:**` alias (first non-empty wins, frontmatter preferred) — and
thread them through `classifyKind` / `classifyPriority` / `domainOf`, exactly
like gh labels. Parser: `extensions/util/plan-frontmatter.ts` (no YAML dep).
Dir-default kind now yields only when labels/title give no stronger kind;
done-detection is never bypassed by labels.

Proposed in loop-lore worktree `tree/unified-spec-framework` (commit
`d3a03fb72`); allocates to omp-plugins per the 2026-09-15 harmonization
directive ("allocate the task document there if expansion for new spec is
required").

## Acceptance Criteria

- [x] `planTickets` reads frontmatter/header labels for every `.plan/{tickets,epics,backlog}/*.md`
- [x] `**Labels:**`, `**Tags:**`, and YAML `labels:` all recognized (precedence: frontmatter > Labels > Tags)
- [x] `WorkTicket.domain` reflects the first non-kind, non-priority, non-severity label
- [x] `WorkTicket.kind` reflects matching `LABEL_KINDS` entry
- [x] `WorkTicket.priority` reflects `LABEL_PRIORITY_RE` / `LABEL_PRIORITY_PREFIX_RE` / severity words
- [x] Done-detection (STATUS_DONE_RE) still filters; labels never bypass
- [x] Tests in `find-work.test.ts` (fixture matrix + readPlanLabels unit tests)
- [x] Docs updated (README slash-command bullet, find-work.ts header comment)
