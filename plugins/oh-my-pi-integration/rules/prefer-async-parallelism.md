---
name: prefer-async-parallelism
description: "If possible to identify — prefer async code: multiple tasks running in parallel or a framework-managed loop are much more effective than sequential execution; counter-rationale: fast operations should run in one thread due to cache locality and thread/async overhead"
condition: ["(?=[\\s\\S]*async|await|Promise|concurrent|parallel)(?=[\\s\\S]*sequential|one by one|one at a time|blocking (call|loop))(?=[\\s\\S]*in parallel|at the same time|concurrently|fire off)"]
scope: ["text", "thinking"]
---

If possible to identify — prefer async code. Multiple independent tasks running in parallel, or a framework-managed loop (event loop, asyncio, tokio), are much more effective than sequential execution.

THE RULE:
- Independent I/O-bound work → run concurrently: parallel in-flight operations (see async-collector-selection for WHICH collector: all / allSettled / race).
- Framework-managed loops over manual blocking: the runtime's scheduler interleaves waiting I/O with compute; a hand-written sequential loop serializes what the framework would overlap.
- If a task CAN be async (the API returns a promise/future, the operation waits on I/O), prefer that shape over blocking the thread.

COUNTER-RATIONALE (apply when it wins):
- FAST operations should run in ONE THREAD: per-task async/thread overhead + lost cache locality exceed the gains. A tight CPU-bound loop on contiguous data is fastest sequentially on one core — spawning tasks to "parallelize" it adds scheduling cost and evicts the working set.
- Decision input: I/O-bound vs CPU-bound; task size vs overhead; dependency order; data layout (cache locality).

TIES: async-collector-selection (collector choice by semantics), avoid-intermediate-array-allocations (don't materialize parallel results into extra arrays), harness-tooling-discipline.

DON'T OVER-APPLY: sequential execution stays the correct default for dependent work (B needs A), small N where overhead dominates, ordering-sensitive side effects, and non-idempotent side-effectful work (see async-collector-selection). The rule prefers parallelism where it pays — it does not demand it everywhere.
