---
name: premature-optimization-consideration
description: "Consider effective structures and algorithms up front ('premature optimization') to avoid returning to the topic later — dynamic programming, dicts vs arrays, sets for lookups when sets are big — BUT prefer memory-bounded naive solutions when memory is constrained, rather than allocating uncontrollably"
condition: ["(?=[\\s\\S]*performance|optimiz|fast|speed|slow|latency|lookup|search (is|in) (an? )?(array|set|dict|map)|dynamic programming)(?=[\\s\\S]*dict|map|set|array|hash|list (vs|or) (dict|set)|lookup (table|structure)|memoiz|\\bDP\\b)(?=[\\s\\S]*memory (constrained|bounded|limit)|allocation|uncontrolled|naive (solution|approach)|simple (solution|approach))"]
scope: ["text", "thinking"]
---

CONSIDER effective structures and algorithms up front ("premature optimization") for cases you would otherwise return to later — dynamic programming, dicts vs arrays, sets for lookups when the set is big — and weigh the memory cost.

THE RULE:
- DICT VS ARRAY: for lookup-by-key, a dict/map/set beats a linear array scan when lookups are frequent or N is large (see hot-code-datastructure-todos: container choice is the highest-leverage performance decision). Use a SET for membership when N is big — `s.has(x)` is O(1) vs an `array.includes` scan.
- DP / REUSE: where a computation repeats subproblems, consider memoization/dynamic programming instead of recomputing (name the tradeoff).
- THE MEMORY COUNTERPOINT: if MEMORY IS CONSTRAINED, prefer the NAIVE solution that may be slower but does NOT ALLOCATE uncontrollably — a set/dict/memo can balloon memory; the bounded naive approach is the correct call there. NAME the constraint that decides.
- AVOID RETURNING LATER: settle the structure decision NOW (see hot-code-datastructure-todos; avoid-intermediate-array-allocations for the memory/alloc side) so the topic does not resurface as a refactor.

WHY: the structure/algorithm decision is the highest-leverage and cheapest to change at design time; revisiting it later is a refactor. The buffer against over-optimization is the memory constraint: structure-aware when memory allows, naive when it does not.

TIES: hot-code-datastructure-todos, avoid-intermediate-array-allocations, async-collector-selection, prefer-async-parallelism, bounded-paginated-reads.

DON'T OVER-APPLY: optimize only where the cost is real (hot path, large N, frequent lookups) — premature optimization of cold, tiny code is wasted complexity. The rule is "consider and settle the decision", not "micro-optimize everything".
