---
name: hot-code-precompiled-hooks
description: "Related to TODO — for hot code parts, analyze them for future pre-compiled hooks (native addons, precompiled binaries, SQLite triggers, precompiled regexes, caches), and record the analysis with its rationale — if the overhead is too big, pre-compilation may not be possible and that must be stated"
condition: ["hot (path|loop|code|section)|per-(request|turn|item)|inner loop|high-frequency", "perf|performance|overhead|profiling|benchmark|native (addon|module)|N-API|precompil|pre-compil|JIT|compile", "regex|SQLite trigger|materialized|cache"]
scope: ["text", "thinking"]
---

For HOT code parts — per-request, per-turn, per-item loops — analyze them for future pre-compiled hooks, and record the analysis with its rationale.

THE RULE:
- When you identify a hot path, ask: could part of it become a pre-compiled hook? Candidates: native addons (N-API), precompiled binaries, SQLite triggers/views, precompiled regexes, JIT-friendly patterns, memoization/caches, generated code.
- Write the analysis as a comment/TODO next to the hot code: what would move to the compiled layer, and the RATIONALE — why now, or why NOT:
  - `// TODO(perf): this regex is rebuilt per request — precompile once` (cheap, obvious).
  - `// TODO(perf): candidates: N-API for the byte-shuffle — rejected for now: process boundary overhead (~Xµs) exceeds per-call cost; revisit if call volume grows N×`.
- The ANALYSIS is the deliverable; the hook is the future. A hot path with no recorded analysis is a performance landmine nobody owns; with the analysis, the decision is auditable and the trigger for re-evaluation is named.

WHY THE RATIONALE MATTERS: "if overhead is too big, might not be possible" — a pre-compiled hook is not free: the boundary (FFI/process/context-switch) has its own cost. The comment must state the tradeoff numerically or structurally, so a future change in volume (see forward-compatible-datastructures: TODO the trigger) knows when to revisit.

TIES: hot-code-datastructure-todos (data-structure TODOs on hot paths), avoid-intermediate-array-allocations (per-item allocation is usually the first perf win — analyze that before reaching for native), todo-pitfall-comments.

DON'T OVER-APPLY: cold code (once-per-session init, error paths) gets no pre-compilation analysis — the analysis budget belongs to paths that actually run at scale. And prefer the cheap wins (allocation, regex reuse, caching) before proposing native boundaries.
