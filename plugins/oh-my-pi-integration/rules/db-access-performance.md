---
name: db-access-performance
description: "For DB access — name the performance decisions explicitly: many small requests vs one big request, declared timeout constraints, retry possibility (idempotency), and a fast-fail path on non-transient errors"
condition: ["(?=[\\s\\S]*db|database|query|sql|n\\+1|round trip|connection (pool|count)|rows)(?=[\\s\\S]*many (request|query)|one big (request|query)|batch|bulk|collector|join)(?=[\\s\\S]*timeout|deadline|retry|backoff|fast fail|fail fast|slow query|latency|load)"]
scope: ["text", "thinking"]
---

For database access, consider performance explicitly and NAME the decisions. The behavior is reviewable only if it is explicit.

THE RULE — name each decision on the hot/risky DB paths:
- MANY vs ONE: evaluate N+1 / many-small-requests vs one-big-request (join, batch, collector). Prefer batched/collector patterns for per-item work (see async-collector-selection, prefer-async-parallelism), but weigh one-big against payload size and lock/cursor cost (see data-size-extensibility). Name which you chose and why; an unexamined N+1 is the default bug.
- TIMEOUT CONSTRAINTS: confirm queries/transactions have declared timeouts so a slow/hung query cannot block the path indefinitely (see wrap-unsafe-language-apis: no-timeout defaults leak). Name the timeout and its consequence (what fails, what the caller does).
- RETRY POSSIBILITY: confirm whether retries are safe — is the operation idempotent (see unique-identifiers-confirmed: idempotency keys)? Retryable vs not, with backoff; never retry non-idempotent writes blindly. Mechanics live in async-collector-selection and deliberate-error-handling — reference them, do not re-implement.
- FAST-FAIL PATH: confirm the fast-fail path — fail fast on clear permanent errors (validation, auth/forbidden, not-found) without a retry loop; distinguish transient (retryable) from permanent (fast-fail). A retry loop on a permanent error is a hang (see deliberate-error-handling: handle-or-propagate, never swallow).

WHY: DB access is where performance and reliability failures concentrate — too many round trips, hung queries, unsafe retries, and retry loops that cannot complete. Naming many-vs-one, timeout, retry, and fast-fail makes each explicit and auditable instead of emergent.

TIES: unique-identifiers-confirmed, async-collector-selection, deliberate-error-handling, data-size-extensibility, wrap-unsafe-language-apis, prefer-async-parallelism, hot-code-precompiled-hooks, strict-review-standards.

DON'T OVER-APPLY: not every query needs a micro-optimization pass — apply the explicit-decision discipline to hot/risky DB paths (see hot-code-precompiled-hooks for hot-path analysis) and to any path with real timeout/retry semantics. Cold reads with no retry need only a one-line name, not a design.
