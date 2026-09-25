---
name: todo-pitfall-comments
description: "Related to TODO — leave comments for potential pitfalls and future improvements, with the TODO marker or without it if project linting/hook rules prohibit TODO keywords"
condition: ["^(?=[\\s\\S]*TODO|FIXME|XXX|HACK)(?=[\\s\\S]*pitfall|trap|gotcha|future (improvement|work|extension)|known (issue|limitation)|follow-up|when (this|that) (lands|changes|is added))"]
scope: ["text", "thinking"]
---

- Spot a pitfall/future improvement → comment it (VALUE = the knowledge, not the marker); name what could break, the trigger, the coming change next to the code — `// TODO(pitfall): v1.3 changes this wire format — re-validate when upstream lands` (see forward-compatible-datastructures).
- No-TODO lint/hooks → no marker: `// Pitfall: …` / `// Future: …` / `// Known limitation: …`. The ban is on the marker, not the knowledge; silent dropping is worse. Prefer the marker when allowed (greppable, review-visible); markerless = lint-constrained only.

DON'T OVER-APPLY: no trivia spam — one line per real finding, where the future reader looks; code restatement is noise; trigger + fix is an investment.
