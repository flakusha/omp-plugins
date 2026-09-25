---
name: hot-code-precompiled-hooks
description: "Related to TODO — for hot code parts, analyze them for future pre-compiled hooks (native addons, precompiled binaries, SQLite triggers, precompiled regexes, caches), and record the analysis with its rationale — if the overhead is too big, pre-compilation may not be possible and that must be stated"
condition: ["^(?=[\\s\\S]*hot (path|loop|code|section)|per-(request|turn|item)|inner loop|high-frequency)(?=[\\s\\S]*perf|performance|overhead|profiling|benchmark|native (addon|module)|N-API|precompil|pre-compil|JIT|compile)(?=[\\s\\S]*regex|SQLite trigger|materialized|cache)"]
scope: ["text", "thinking"]
---

Hot loops (per-request/turn/item): analyze for pre-compiled hooks; record the rationale.

- CANDIDATES: native addons (N-API), precompiled binaries, SQLite triggers/views, precompiled regexes, JIT patterns, memoization/caches, generated code.
- WRITE next to the code: what moves to the compiled layer + why / why NOT:
  - `// TODO(perf): regex rebuilt per request — precompile once`
- Analysis is the deliverable, hook the future — unrecorded = unowned landmine; recorded = auditable decision + named revisit trigger.

WHY: hooks aren't free — boundary (FFI/process/context-switch) costs; state it numerically/structurally so volume changes (see forward-compatible-datastructures) know when to revisit.

TIES: hot-code-datastructure-todos, avoid-intermediate-array-allocations (per-item allocation first), todo-pitfall-comments.

DON'T OVER-APPLY: cold code (init, error paths) gets none; prefer cheap wins (allocation, regex reuse, caching) before native boundaries.
