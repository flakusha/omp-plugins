---
name: async-collector-selection
description: "When logic affords calling a promise/async collector, handle multiple independent async operations simultaneously — pick the collector by semantics (Promise.all fallible, Promise.allSettled resolvable/retryable, Promise.race priority), handle errors per collector (race losers need handlers or they leak unhandled rejections), clear memory and drop non-required data, retry only under performance/time constraints"
condition: ["^(?=[\\s\\S]*Promise\\.all|Promise\\.allSettled|Promise\\.race|allSettled)(?=[\\s\\S]*gather|asyncio|FIRST_COMPLETED|errgroup)(?=[\\s\\S]*async[\\s\\S]{0,40}?(parallel|simultaneous|concurrent)|concurrent[\\s\\S]{0,40}?(promise|async))(?=[\\s\\S]*collector|promise[\\s\\S]{0,40}?collect)(?=[\\s\\S]*fallible|resolvable|retryable|retry)(?=[\\s\\S]*handle[\\s\\S]{0,40}?(multiple|several)[\\s\\S]{0,40}?promise|parallel[\\s\\S]{0,40}?promise|unhandled rejection)"]
scope: ["text", "thinking"]
---

Handle multiple independent async operations SIMULTANEOUSLY — never serialize what can run in parallel. Pick the collector by semantics:

DECISION TABLE:
- `Promise.all` (`asyncio.gather` default): FALLIBLE — all results required; any rejection fails the batch fast. For batches that must succeed as a unit.
- `Promise.allSettled` (`gather(return_exceptions=True)`): RESOLVABLE/RETRYABLE — collects every outcome; inspect per-item status when partial success is acceptable and you need to know which failed.
- `Promise.race` (`asyncio.wait` FIRST_COMPLETED): PRIORITY — first settlement wins; timeouts, fastest-source, priority path.

ERRORS PER COLLECTOR:
- `all`: rejection propagates immediately; the others keep running (handlers attached — no unhandled leak — but not cancelled; cancel/abort explicitly if they must not continue).
- `allSettled`: always resolves — do NOT mistake settlement for success. Partition fulfilled/rejected, handle each side, retry rejected (below). Never use it when all-or-nothing is the contract — it silently converts failures into "settled".
- `race`: THE TRAP — losers' rejections are UNHANDLED unless every loser gets a handler. Attach `.catch(log)`/noop to each loser and drop its results at once — non-required data.

MEMORY:
- Drop non-required data (race losers, unused payloads) — discard references immediately.
- Huge N: `all`/`allSettled` materialize every result — use bounded concurrency (pool/limit), not 10^5 in-flight promises (see avoid-intermediate-array-allocations, hot-code-datastructure-todos). Unbounded fan-out is a memory blowup dressed as parallelism.
- Long-lived loops: clear references after each batch; never accumulate settled results.

RETRY ONLY UNDER CONSTRAINTS: rejected operations may retry when (a) retryable/idempotent, (b) budget allows, (c) attempts bounded with backoff. Never blind-retry non-idempotent work; when the budget forbids retry, surface the failure.

DON'T OVER-APPLY:
- Serial `await` is CORRECT for dependent operations (B needs A's result), small N where collector overhead outweighs benefit, or when ordering matters for side effects.
- Do not parallelize side-effectful non-idempotent work for speed alone — ordering and duplicate-risk costs usually exceed the gain.
- Match the project's async conventions (see repo-tooling-scoped-usage); deviate only when the hot path justifies it (hot-code-datastructure-todos).
