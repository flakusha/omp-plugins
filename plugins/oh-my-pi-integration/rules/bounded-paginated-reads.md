---
name: bounded-paginated-reads
description: "For reads that can return large/many results — read in bounded, batched chunks with pagination, check 'timeout remaining' between small batches, and prefer parallel small SELECTs where reads are independent"
condition: ["^(?=[\\s\\S]*pagination|paginate|page\\b|batch|limit\\b|offset|next (page|cursor)|many (rows|results|records))(?=[\\s\\S]*SELECT|query|read (from|the) (db|database)|fetch (all|many|rows))(?=[\\s\\S]*timeout (remaining|left)|deadline (remaining|left)|parallel (SELECT|query|read)|small (read|batch|query))"]
scope: ["text", "thinking"]
---

For reads that can return LARGE or MANY results, read in BOUNDED, BATCHED chunks, never one unbounded read:

- PAGINATE: pages/batches (limit+offset or keyset/cursor) instead of a query whose buffer grows with the dataset (see protocol-timeout-streaming: do not buffer unbounded data; data-size-extensibility).
- "TIMEOUT REMAINING" CHECKS: in a pagination loop, check remaining time/deadline between small batches — "honor the timeout" is a LOOP BOUND, not a one-shot: read a small batch, check the budget, stop gracefully when nearly exhausted (see protocol-timeout-streaming, db-access-performance). Without it, a 10k-row loop blows the deadline even though each page was fast.
- PARALLEL SMALL SELECTs: where reads are INDEPENDENT, prefer several small parallel SELECTs over one giant join/cartesian read (see db-access-performance: many-vs-one; prefer-async-parallelism; async-collector-selection: bounded concurrency for large counts).
- Each is a decision: name the batch/page size and the read strategy.

WHY: an unbounded read or unguarded pagination loop exhausts memory or runs past the deadline; bounded batches with timeout-remaining checks and small parallel reads keep memory, latency, and responsiveness bounded.

TIES: db-access-performance, protocol-timeout-streaming, prefer-async-parallelism, async-collector-selection, data-size-extensibility.

DON'T OVER-APPLY: for inherently small result sets, pagination/parallel-splitting is overhead — apply where "large/many" is real (see db-access-performance: name the many-vs-one decision on hot/risky paths).
