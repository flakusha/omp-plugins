---
name: split-large-files-classes
description: "When a file or class grows too large, split it — file into multiple cohesive functions/modules by responsibility, over-large class into dispatchers or smaller collaborators, or recombine into composable units; split by cohesion and reason-to-change, never by line count, and propose restructuring rather than silently doing it"
condition: ["file (is|gets|grows) (too|very) (large|big|long)|large file|file.*too (large|big|long)", "class.*(too|very) (large|big)|god class|large class", "split (the )?(file|class|module)", "dispatcher|dispatch(er)? class|extract.*(class|module|method)", "recombine|recompos", "break.*(file|class|module).*(up|into)"]
scope: ["text", "thinking"]
---

When a file or class grows too large, split it. Oversized units are hard to read, test, and change — but the split must follow cohesion and reason-to-change, not line count. This extends compact-single-responsibility-functions from the function level to the file and class level.

FILE TOO LARGE:
- Split by cohesion: group related functions into modules that each have one responsibility and a clear interface; each module is importable and testable on its own.
- Cohesion, not size: two unrelated responsibilities in one file are a split candidate even if short; one cohesive file can be long and still fine (see compact-single-responsibility-functions: the axis is responsibility, not length).

CLASS TOO LARGE (a god-class with many responsibilities):
- SPLIT INTO DISPATCHERS: the class delegates to focused handlers/strategies — a thin facade that routes to small, single-responsibility collaborators by behavior.
- OR SPLIT INTO COHESIVE COLLABORATORS: extract each responsibility into its own small class, injected/used by the original — one responsibility per class.
- OR RECOMBINE: reconsider composition entirely — sometimes a monolith recombines into composable smaller units with clear interfaces and no tangled state (see compact-single-responsibility-functions: extend by adding peers, not branches).

SPLIT BY RESPONSIBILITY, NOT LINE COUNT: an 800-line class with one cohesive job may be fine; a 200-line class doing four jobs is a violation. Do not split purely to shrink numbers — that creates import/indirection noise.

PROPOSE, THEN SPLIT:
- Restructuring is a visible change: propose the split and its module/class boundaries (see repo-tooling-scoped-usage: do not silently restructure working code), migrate all call sites in the same change, and keep behavior identical (clean cutover, no shims).
- New code is written split from the start; only existing large units need a proposed refactor.
- Tests move with the code: each split module/class keeps its tests (see discover-before-create: verify the reused/moved path is wired and tested).
