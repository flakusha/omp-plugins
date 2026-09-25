---
name: premature-optimization-consideration
description: "Consider effective structures and algorithms up front ('premature optimization') to avoid returning to the topic later — dynamic programming, dicts vs arrays, sets for lookups when sets are big — BUT prefer memory-bounded naive solutions when memory is constrained, rather than allocating uncontrollably"
condition: ["^(?=[\\s\\S]*performance|optimiz|fast|speed|slow|latency|lookup|search (is|in) (an? )?(array|set|dict|map)|dynamic programming)(?=[\\s\\S]*dict|map|set|array|hash|list (vs|or) (dict|set)|lookup (table|structure)|memoiz|\\bDP\\b)(?=[\\s\\S]*memory (constrained|bounded|limit)|allocation|uncontrolled|naive (solution|approach)|simple (solution|approach))"]
scope: ["text", "thinking"]
---

CONSIDER structures/algorithms up front — DP, dicts vs arrays, sets for lookups — and weigh memory.
- DICT VS ARRAY: lookup-by-key → dict/map/set when frequent or N large; SET for membership — `has` is O(1) (see hot-code-datastructure-todos).
- DP: repeated subproblems → memoization; name the tradeoff.
- MEMORY COUNTERPOINT: MEMORY CONSTRAINED → NAIVE, non-allocating solution; set/dict/memo can balloon — NAME the deciding constraint.
- SETTLE NOW: decide up front (see avoid-intermediate-array-allocations); not resurface as a refactor.
WHY: highest-leverage, cheapest at design time; the over-optimization buffer is memory.
TIES: hot-code-datastructure-todos, avoid-intermediate-array-allocations, async-collector-selection, prefer-async-parallelism, bounded-paginated-reads.
DON'T OVER-APPLY: optimize only where cost is real (hot path, large N, hot lookups) — "consider and settle", not micro-optimize.
