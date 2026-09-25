---
name: hot-code-datastructure-todos
description: "For potentially hot code, review the data structure picks — the container choice is the highest-leverage performance decision — and consider a commented TODO marking the future slot for a compiled/native implementation hook (FFI, wasm, native addon, lower-level rewrite) in script languages; profiling-first, no premature optimization"
condition: ["^(?=[\\s\\S]*hot (code|path|loop)|performance[ -]sensitive|\\bperf\\b|inner loop)(?=[\\s\\S]*data structure|datastructure|collection|container)(?=[\\s\\S]*choose[\\s\\S]{0,40}?(data structure|container)|array vs|Set vs Map|Map vs)(?=[\\s\\S]*compiled (implementation|hook)|native (addon|module|extension)|FFI|\\bwasm\\b)(?=[\\s\\S]*TODO[\\s\\S]{0,40}?(compile|native|optimiz|ffi))(?=[\\s\\S]*O\\(n)"]
scope: ["text", "thinking"]
---

Hot code (inner loops, per-request paths, large-N): review data structure picks; consider a compiled hook TODO. Profiling-first.

- CONTAINER ⇔ REAL OPERATIONS: membership → Set; keyed lookup → Map/dict; sequence → array; ordered ins/rem → deque/list; priority → heap; dedup+order → ordered Set. Wrong picks compound: O(n²) scans, rehashing, cache misses, allocation churn (see avoid-intermediate-array-allocations).
- REAL complexity, not assumed: `includes()` in a loop is the classic O(n²) a Set fixes in one line. Prefer native containers (JS Map/Set, Python dict/set/deque, Go map/slice, Rust Vec/HashMap) over hand-rolled unless measurably justified.

- TODO THE COMPILED HOOK (script languages): correct, readable version now; TODO the future compiled path (FFI, wasm, native addon, C extension, SQL pushdown, rewrite), naming structure, trigger, and path. WHY: enforcement follows measured need (see compact-single-responsibility-functions); a zero-cost hatch: optimization becomes find-and-replace.

DON'T OVER-APPLY:
- Only genuinely hot code; cold ceremony is premature optimization.
- Not a license for unreadable micro-optimization (see compact-single-responsibility-functions).
- Follow an existing compiled-hook pattern (see repo-tooling-scoped-usage).
- array→Set one-liners: just do them; the TODO is for the compiled path.
