---
name: hot-code-datastructure-todos
description: "For potentially hot code, review the data structure picks — the container choice is the highest-leverage performance decision — and consider a commented TODO marking the future slot for a compiled/native implementation hook (FFI, wasm, native addon, lower-level rewrite) in script languages; profiling-first, no premature optimization"
condition: ["hot (code|path|loop)|performance[ -]sensitive|\\bperf\\b|inner loop", "data structure|datastructure|collection|container", "choose.*(data structure|container)|array vs|Set vs Map|Map vs", "compiled (implementation|hook)|native (addon|module|extension)|FFI|\\bwasm\\b", "TODO.*(compile|native|optimiz|ffi)", "O\\(n"]
scope: ["text", "thinking"]
---

For potentially hot code — inner loops, per-request/per-record paths, large-N transforms — review the data structure choices, and consider marking the spot for a future compiled-implementation hook. This is profiling-first discipline, not premature optimization.

REVIEW THE DATA STRUCTURE PICKS (the highest-leverage decision in hot code):
- MATCH THE CONTAINER TO THE OPERATIONS you actually run in the hot path: membership → Set; keyed lookup → Map/dict; sequence/order → array/list; ordered insertion/removal → deque/linked list; priority → heap; dedup + order → Set/ordered structure. A wrong pick compounds: O(n²) membership scans, rehashing, cache misses, allocation churn (see avoid-intermediate-array-allocations).
- CHECK THE COMPLEXITY OF THE REAL OPERATIONS, not the assumed ones: an `includes()` inside a loop is the classic O(n²) that a Set fixes in one line.
- Prefer the language's native containers (JS Map/Set, Python dict/set/deque, Go map/slice, Rust Vec/HashMap) over hand-rolled equivalents unless the hand-rolled one is measurably justified.

CONSIDER THE COMMENTED TODO FOR A COMPILED HOOK (script languages):
- Write the CORRECT, readable interpreted version now. Add a specific TODO at the spot marking the future slot for a compiled/native implementation — FFI, wasm, native addon, C extension, SQL-side pushdown, or a lower-level rewrite.
- The TODO must be actionable, not vague: name the data structure, the trigger condition, and the compiled path — e.g. `// TODO(hot-path): if N > 1e5, replace in-JS Set with native Set via FFI (see src/native/)`.
- WHY A TODO, NOT THE IMPLEMENTATION: enforcement follows the measured need — do not optimize blind (see compact-single-responsibility-functions). The TODO is the zero-cost escape hatch that turns the future optimization into a find-and-replace instead of a rewrite, and it documents for the next agent exactly where the compiled hook plugs in.

DON'T OVER-APPLY:
- Only genuinely potentially-hot code gets the review and the TODO; ceremony on cold/one-off code is premature optimization.
- The TODO is a marker, not a license to write unreadable micro-optimized code NOW — readability and correctness stay the default (see compact-single-responsibility-functions).
- If the project already has a compiled-hook pattern (native modules, wasm setup), follow it; do not invent a parallel mechanism (see repo-tooling-scoped-usage).
- If a datastructure change is a behavior-neutral one-liner (array→Set), just make it; the TODO is for the compiled path, not for trivial swaps.
