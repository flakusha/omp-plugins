---
name: todo-pitfall-comments
description: "Related to TODO — leave comments for potential pitfalls and future improvements, with the TODO marker or without it if project linting/hook rules prohibit TODO keywords"
condition: ["(?=[\\s\\S]*TODO|FIXME|XXX|HACK)(?=[\\s\\S]*pitfall|trap|gotcha|future (improvement|work|extension)|known (issue|limitation)|follow-up|when (this|that) (lands|changes|is added))"]
scope: ["text", "thinking"]
---

When you spot a potential pitfall or a future improvement while coding, leave a comment recording it — the VALUE is the recorded knowledge, not the marker.

THE RULE:
- Name the pitfall/improvement next to the code it concerns: what could break, what the trigger is, what the future change looks like. Actionable, not vague: `// TODO(pitfall): v1.3 changes this wire format — re-validate here when upstream lands` (see forward-compatible-datastructures for the same TODO pattern at expansion points).
- If the project's linting/hook rules PROHIBIT `TODO` keywords (some repos enforce no-TODO), write the same comment WITHOUT the marker: `// Pitfall: …` / `// Future: …` / `// Known limitation: …`. The ban is on the marker, not on recording the knowledge — silently dropping the note to satisfy a linter is worse than either option.
- Prefer the marker when allowed: `TODO` is greppable and surfaces in review; the no-marker variant is for lint-constrained projects only.

DON'T OVER-APPLY: no comment spam for trivia — record real pitfalls and real improvement opportunities, one line each, where the future reader will be looking. A comment that restates the code is noise; a comment that names the trigger and the fix is an investment.
