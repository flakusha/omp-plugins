---
name: async-collector-selection
description: "When logic affords calling a promise/async collector, handle multiple independent async operations simultaneously — pick the collector by semantics (Promise.all fallible, Promise.allSettled resolvable/retryable, Promise.race priority), handle errors per collector (race losers need handlers or they leak unhandled rejections), clear memory and drop non-required data, retry only under performance/time constraints"
condition: ["(?=[\\s\\S]*Promise\\.all|Promise\\.allSettled|Promise\\.race|allSettled)(?=[\\s\\S]*gather|asyncio|FIRST_COMPLETED|errgroup)(?=[\\s\\S]*async.*(parallel|simultaneous|concurrent)|concurrent.*(promise|async))(?=[\\s\\S]*collector|promise.*collect)(?=[\\s\\S]*fallible|resolvable|retryable|retry)(?=[\\s\\S]*handle.*(multiple|several).*promise|parallel.*promise|unhandled rejection)"]
scope: ["text", "thinking"]
---

When logic affords calling an async collector, handle multiple independent async operations SIMULTANEOUSLY — do not serialize what can run in parallel (await one, then the next, when neither depends on the other). The collector is the tool; pick it by semantics.

PICK THE COLLECTOR BY SEMANTICS (the decision table):
- `Promise.all` (Python `asyncio.gather` default): FALLIBLE — all results required; any rejection fails the batch fast. Use when the batch must succeed as a unit.
- `Promise.allSettled` (`gather(return_exceptions=True)`): RESOLVABLE / RETRYABLE — collects every outcome; inspect per-item status; partial success is acceptable and you need to know which items failed.
- `Promise.race` (`asyncio.wait` FIRST_COMPLETED): PRIORITY — first settlement wins; timeouts, fastest-source, priority path.

HANDLE ERRORS PER COLLECTOR:
- `all`: rejection propagates immediately; the others keep running (their handlers are attached — no unhandled leak — but they are not cancelled; if they must not continue, cancel/abort them explicitly).
- `allSettled`: always resolves — do NOT mistake settlement for success. Partition fulfilled/rejected from statuses, handle each side, and retry rejected ones (see retry below). Never use allSettled when all-or-nothing is the contract — it silently converts failures into "settled".
- `race`: THE TRAP — the losers' rejections are UNHANDLED unless you attach a handler to every loser. Always attach `.catch(log)`/noop to race losers, and drop their results immediately — they are non-required data.

MEMORY DISCIPLINE:
- Drop non-required data: race losers' results, unused payloads — discard references at once; do not hold what you do not use.
- Very large N: `all`/`allSettled` materialize every result — for huge batches use bounded concurrency (pool/limit), not 10^5 promises in flight at once (see avoid-intermediate-array-allocations, hot-code-datastructure-todos). Unbounded fan-out is a memory blowup dressed as parallelism.
- Long-lived loops: clear references after each batch; do not accumulate settled results.

RETRY ONLY UNDER CONSTRAINTS: retry rejected operations when (a) the operation is retryable/idempotent, (b) performance/time budget allows, (c) attempts are bounded with backoff. Never blind-retry non-idempotent work; when the budget forbids retry, surface the failure instead.

DON'T OVER-APPLY:
- Serial `await` is CORRECT when operations are dependent (B needs A's result), when N is small and collector overhead outweighs benefit, or when ordering guarantees matter for side effects.
- Do not parallelize side-effectful non-idempotent work for speed alone — the ordering and duplicate-risk costs usually exceed the gain.
- Match the project's async conventions (see repo-tooling-scoped-usage): some codebases deliberately serialize for clarity; follow the established pattern unless the hot path justifies deviation (hot-code-datastructure-todos).
