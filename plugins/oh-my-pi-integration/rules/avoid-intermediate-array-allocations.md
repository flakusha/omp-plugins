---
name: avoid-intermediate-array-allocations
description: "Chained functional array methods (.map().filter().reduce()...) allocate a new array per stage — shadow memory expansion on large collections and hot paths; avoid expanding memory unless the result is a genuinely new isolated data structure; prefer single-pass loops or one-pass reduce when size or frequency is real"
condition: ["\\.map\\(|\\.filter\\(|\\.reduce\\(|\\.flatMap\\(|\\.forEach\\(|\\.some\\(|\\.every\\(|\\.find\\(", "chained? (functional )?(methods?|calls|array)", "intermediate (array|collection|allocation)", "allocat(e|ion|ing)", "shadow (array|allocation|memory)", "iterator|generator|transducer", "memory.*(array|chain|map|filter)"]
scope: ["text", "thinking"]
---

Chained functional array methods shadow-allocate: each stage materializes a full intermediate array. `xs.map(f).filter(g)` builds array1 (mapped, len N), then array2 (filtered, ≤N) — two stages = one throwaway array of O(N); three stages = two. On large collections this expands memory and GC pressure, and on hot paths it costs real time.

WHEN IT MATTERS:
- Large collections (10^4+ elements), hot paths (per-request, per-frame, per-record), memory-constrained or high-throughput environments, and pipelines over big inputs.
- WHEN IT DOESN'T: small collections, cold paths, one-off setup — the chain is readable and fine. Do not churn working chains purely for style; measure first (see compact-single-responsibility-functions: enforcement follows the measured need).

WHEN ALLOCATION IS REQUIRED — the exception:
- If the result IS a genuinely new isolated data structure that must exist (an API response shape, a snapshot, an immutable transformed copy to be stored or passed on), the final allocation is required — the rule targets the THROWAWAY intermediates, not the destination. Build the new structure directly, but avoid the extra stages en route (e.g. one reduce instead of map-then-filter-then-reduce).

PREFERRED PATTERNS:
- SINGLE-PASS LOOP: `for...of` with push + conditional — one array, no intermediates, often the clearest.
- ONE-PASS REDUCE: build the target structure directly with a single `.reduce()`, folding transform + filter + grouping into one traversal.
- LAZY PIPELINES: generators, iterators (e.g. `Iterator.prototype.map`/`filter` where supported), or transducer-style composition — stages stay lazy, no array is materialized until the final consumer forces it.

The choice is deliberate: pick by size and frequency, state the reason when optimizing, and follow the project's existing style (see repo-tooling-scoped-usage).
