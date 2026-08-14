---
name: premature-task-complete
description: "Never declare task complete before all mandatory steps are verified done"
condition: ["(?=[\\s\\S]*^Done[.:!])(?=[\\s\\S]*^Complete[.:!])(?=[\\s\\S]*^All \\w+ saved)(?=[\\s\\S]*\\bmerged?\\b.*\\binto\\b.*\\b\\w+\\b)"]
scope: "text"
---

Before ANY completion marker ('Done', 'Complete', summary table, 'All X saved'): verify every mandatory step is actually finished — session summary, memory saves, verification gates, test runs, and any project-specific finalize step. If the harness's AGENTS.md marks a session/step as MANDATORY before done (e.g. an engram session-summary save), it counts. Do not yield with a completion signal until you have proof all steps are complete in this turn.
