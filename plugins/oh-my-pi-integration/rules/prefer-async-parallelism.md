---
name: prefer-async-parallelism
description: "If possible to identify — prefer async code: multiple tasks running in parallel or a framework-managed loop are much more effective than sequential execution; counter-rationale: fast operations should run in one thread due to cache locality and thread/async overhead"
condition: ["^(?=[\\s\\S]*async|await|Promise|concurrent|parallel)(?=[\\s\\S]*sequential|one by one|one at a time|blocking (call|loop))(?=[\\s\\S]*in parallel|at the same time|concurrently|fire off)"]
scope: ["text", "thinking"]
---

Prefer async where identifiable: independent tasks in parallel or framework-managed loops beat sequential execution.
- Independent I/O-bound work → concurrent in-flight operations (see async-collector-selection for WHICH collector: all / allSettled / race).
- Framework-managed loops: the scheduler interleaves waiting I/O with compute.
- Promise/future API or I/O wait → prefer the async shape.
COUNTER-RATIONALE: FAST operations run in ONE THREAD — overhead plus lost cache locality exceed gains; tight CPU-bound loops are fastest sequentially. Decide by I/O- vs CPU-bound, task size, dependencies, layout.
TIES: async-collector-selection, avoid-intermediate-array-allocations, harness-tooling-discipline.
DON'T OVER-APPLY: sequential stays correct for dependent work, small N, ordering-sensitive/non-idempotent side effects (see async-collector-selection).
