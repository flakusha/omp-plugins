---
name: avoid-intermediate-array-allocations
description: "Chained functional array methods (.map().filter().reduce()...) allocate a new array per stage — shadow memory expansion on large collections and hot paths; avoid expanding memory unless the result is a genuinely new isolated data structure; prefer single-pass loops or one-pass reduce when size or frequency is real"
condition: ["^(?=[\\s\\S]*\\.map\\(|\\.filter\\(|\\.reduce\\(|\\.flatMap\\(|\\.forEach\\(|\\.some\\(|\\.every\\(|\\.find\\()(?=[\\s\\S]*chained? (functional )?(methods?|calls|array))(?=[\\s\\S]*intermediate (array|collection|allocation))(?=[\\s\\S]*allocat(e|ion|ing))(?=[\\s\\S]*shadow (array|allocation|memory))(?=[\\s\\S]*iterator|generator|transducer)(?=[\\s\\S]*memory[\\s\\S]{0,40}?(array|chain|map|filter))"]
scope: ["text", "thinking"]
---

Chained functional array methods shadow-allocate: each stage materializes a full intermediate array (`xs.map(f).filter(g)` = one throwaway O(N) array; three stages = two). On large collections this expands memory and GC pressure; on hot paths it costs real time.

WHEN IT MATTERS: large collections (10^4+), hot paths (per-request/frame/record), memory-constrained or high-throughput environments, pipelines over big inputs. WHEN IT DOESN'T: small collections, cold paths, one-off setup — do not churn working chains for style; measure first (see compact-single-responsibility-functions).

REQUIRED ALLOCATION — the exception: if the result IS a genuinely new isolated data structure that must exist (API response shape, snapshot, immutable copy to store/pass on), the final allocation is required — the rule targets THROWAWAY intermediates, not the destination. Build it directly but drop the extra stages en route (one reduce instead of map-then-filter-then-reduce).

PREFERRED PATTERNS:
- SINGLE-PASS LOOP: `for...of` with push + conditional — one array, no intermediates, often clearest.
- ONE-PASS REDUCE: build the target structure directly, folding transform + filter + grouping into one traversal.
- LAZY PIPELINES: generators, iterators (`Iterator.prototype.map`/`filter` where supported), transducer-style composition — no array materialized until the final consumer forces it.

Pick by size and frequency, state the reason when optimizing, follow the project's style (see repo-tooling-scoped-usage).
