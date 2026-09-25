---
name: split-large-files-classes
description: "When a file or class grows too large, split it — file into multiple cohesive functions/modules by responsibility, over-large class into dispatchers or smaller collaborators, or recombine into composable units; split by cohesion and reason-to-change, never by line count, and propose restructuring rather than silently doing it"
condition: ["^(?=[\\s\\S]*file (is|gets|grows) (too|very) (large|big|long)|large file|file[\\s\\S]{0,40}?too (large|big|long))(?=[\\s\\S]*class[\\s\\S]{0,40}?(too|very) (large|big)|god class|large class)(?=[\\s\\S]*split (the )?(file|class|module))(?=[\\s\\S]*dispatcher|dispatch(er)? class|extract[\\s\\S]{0,40}?(class|module|method))(?=[\\s\\S]*recombine|recompos)(?=[\\s\\S]*break[\\s\\S]{0,40}?(file|class|module)[\\s\\S]{0,40}?(up|into))"]
scope: ["text", "thinking"]
---

When a file or class grows too large, split it — by cohesion and reason-to-change, never line count (see compact-single-responsibility-functions). An 800-line single-job class may be fine; 200 lines doing four jobs is a violation.

FILE TOO LARGE: group related functions into modules — one responsibility each, importable/testable alone. Unrelated responsibilities in one file = split candidate even if short; a cohesive file can be long and fine.

CLASS TOO LARGE:
- DISPATCHER: thin facade routing to focused handlers/strategies.
- COLLABORATORS: one small class per responsibility.
- RECOMBINE: recompose into composable units, clear interfaces, no tangled state (add peers, not branches).

PROPOSE, THEN SPLIT: restructuring is visible — propose boundaries (see repo-tooling-scoped-usage: don't silently restructure), migrate all call sites in the same change, clean cutover with no shims. Write new code split from the start; tests move with the code (see discover-before-create: verify the moved path is wired and tested).
