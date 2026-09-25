---
name: async-research-during-build
description: "When developing — identify if additional search/research needs to be spun up asynchronously or in a separate agent; work on the implementation and then verify whether additional edits are needed"
condition: ["^(?=[\\s\\S]*research|investigate|search (for|the)|look up|check docs|find out)(?=[\\s\\S]*while (implementing|working|building)|in the meantime|in parallel|separate agent|subagent|background (task|agent))(?=[\\s\\S]*verify (after|whether)|re-check|revisit)"]
scope: ["text", "thinking"]
---

When developing, identify whether additional research (docs lookup, API verification, reference implementation, best practice) can run asynchronously — background task or separate agent (see harness-tooling-discipline) — while you implement:

- SPLIT: if the research does NOT change the core design, start it asynchronously and implement what is already known.
- VERIFY WHEN IT LANDS: diff findings against what you built; apply only deltas that change behavior (see wiring-sync-and-consolidation: the two-sided check).
- Discipline: never block implementation on research that only adds detail; never skip the verification pass that merges it back.

TENSION — research FIRST: if the result would change the core design (library, format, approach), it is a blocker — do it before building (see research-before-complex-build, discover-before-create). The async split applies to detail-level research, not design-level; state which kind each lookup is before spinning it up.

DON'T OVER-APPLY: a one-line doc check is not worth an agent spawn — spawn only for genuinely substantial or slow research (external docs, unfamiliar library); and never spawn research that must land before the first edit — that inverts the dependency.
