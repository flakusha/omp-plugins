---
name: async-research-during-build
description: "When developing — identify if additional search/research needs to be spun up asynchronously or in a separate agent; work on the implementation and then verify whether additional edits are needed"
condition: ["(?=[\\s\\S]*research|investigate|search (for|the)|look up|check docs|find out)(?=[\\s\\S]*while (implementing|working|building)|in the meantime|in parallel|separate agent|subagent|background (task|agent))(?=[\\s\\S]*verify (after|whether)|re-check|revisit)"]
scope: ["text", "thinking"]
---

When developing, identify whether additional search or research can run asynchronously — in a background task or a separate agent — while you work on the implementation. Then verify whether the research results require additional edits.

THE RULE:
- Split the work: if part of the task is research (docs lookup, API verification, reference implementation, best practice) and part is implementation, and the research does NOT change the implementation's core design — start the research asynchronously (background task/subagent; see harness-tooling-discipline: route through the harness) and implement what is already known.
- When the research lands, VERIFY whether additional edits are needed: diff the research findings against what you built; apply only the deltas that actually change behavior (see wiring-sync-and-consolidation: the two-sided check).
- The pattern's discipline: never block the implementation on research that only adds detail, and never skip the verification pass that merges the research back.

TENSION — when research must come FIRST: if the research result would change the core design (which library, which format, which approach), it is a blocker — do it before building (see research-before-complex-build, discover-before-create). The async split applies to detail-level research, not design-level research. State which kind each lookup is before spinning it up.

DON'T OVER-APPLY: a one-line doc check is not worth an agent spawn — spin up asynchronously only when the research is genuinely substantial or slow (external docs, unfamiliar library). And don't spawn research that must land before the first edit; that inverts the dependency.
