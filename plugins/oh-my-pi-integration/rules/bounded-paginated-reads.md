---
name: bounded-paginated-reads
description: "For reads that can return large/many results — read in bounded, batched chunks with pagination, check 'timeout remaining' between small batches, and prefer parallel small SELECTs where reads are independent"
condition: ["pagination|paginate|page\\b|batch|limit\\b|offset|next (page|cursor)|many (rows|results|records)", "SELECT|query|read (from|the) (db|database)|fetch (all|many|rows)", "timeout (remaining|left)|deadline (remaining|left)|parallel (SELECT|query|read)|small (read|batch|query)"]
scope: ["text", "thinking"]
---

For reads that can return LARGE or MANY results, read in BOUNDED, BATCHED chunks rather than one unbounded single read.

THE RULE — name each:
- PAGINATE: read in pages/batches (limit+offset, or keyset/cursor pagination) instead of a single query whose buffer grows with the dataset (see protocol-timeout-streaming: do not buffer unbounded data; see data-size-extensibility).
- "TIMEOUT REMAINING" CHECKS: in a batch/pagination LOOP, check the remaining time/deadline between small batches — a long loop must not run past the overall timeout. This is exactly where "honor the timeout" is a LOOP BOUND, not a one-shot: read a small batch, check the remaining budget, stop gracefully when it is nearly exhausted (see protocol-timeout-streaming, db-access-performance). Without this check, a 10k-row pagination loop blows the deadline even though each page was fast.
- PARALLEL SMALL SELECTs: where reads are INDEPENDENT, prefer several small parallel SELECTs over one giant join/cartesian read (see db-access-performance: many-vs-one — small parallel wins when independent; see prefer-async-parallelism, async-collector-selection: bounded concurrency for large counts). Name which strategy fits the read's shape.
- Each is a decision, not an afterthought: name the batch/page size and the read strategy.

WHY: an unbounded single read or an unguarded pagination loop either exhausts memory or runs past the deadline; bounded batches with timeout-remaining checks and small parallel reads keep memory, latency, and responsiveness bounded.

TIES: db-access-performance, protocol-timeout-streaming, prefer-async-parallelism, async-collector-selection, data-size-extensibility.

DON'T OVER-APPLY: for inherently small result sets, pagination/parallel-splitting is overhead — apply where "large/many" is real (see db-access-performance: name the many-vs-one decision on hot/risky paths).
