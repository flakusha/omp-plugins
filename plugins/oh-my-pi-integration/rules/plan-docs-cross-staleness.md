---
name: plan-docs-cross-staleness
description: "When modifying files in one planning/documentation area, check the other for stale cross-references"
condition: ["\\.plan/.*\\.md", "docs/.*\\.md", "planning/.*\\.md", "documentation/.*\\.md"]
scope: ["tool:write(**/*.md)", "tool:edit(**/*.md)"]
---

After modifying a markdown file in one planning or documentation area (e.g. `.plan/`, `docs/`, `planning/`, `documentation/`), do minimal cross-reconciliation: check the *other* area for references (epic IDs, ticket IDs, feature names, filenames) that may have gone stale. Update or note if found. Do not batch this into a later pass — reconcile immediately in the same turn.
