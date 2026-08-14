---
name: plan-sync-after-epic-updates
description: "After updating planning/epic/ticket/backlog artifacts, verify they are reconciled with the issue tracker"
condition: ["\\.plan/epics/.*\\.md", "\\.plan/tickets/.*\\.md", "\\b(plan|epic|ticket|backlog)\\b.*\\.md", "planning artifacts"]
scope: ["tool:write", "tool:edit"]
---

After any planning artifact (epic, ticket, backlog, or roadmap) write/edit, run the project's index-reconciliation step to verify the planning index is consistent with the issue tracker. The conventional command is `bun run plan:sync`, but use whatever the project defines. Orphaned artifact files or stale index entries are bugs — the planning index is the source of truth for issue tracking.
