---
name: db-access-performance
description: "For DB access — name the performance decisions explicitly: many small requests vs one big request, declared timeout constraints, retry possibility (idempotency), and a fast-fail path on non-transient errors"
condition: ["^(?=[\\s\\S]*db|database|query|sql|n\\+1|round trip|connection (pool|count)|rows)(?=[\\s\\S]*many (request|query)|one big (request|query)|batch|bulk|collector|join)(?=[\\s\\S]*timeout|deadline|retry|backoff|fast fail|fail fast|slow query|latency|load)"]
scope: ["text", "thinking"]
---

For database access, NAME the performance decisions — reviewable only if explicit. On hot/risky DB paths:

- MANY vs ONE: N+1/many-small vs one-big-request (join, batch, collector). Prefer batched/collector per-item (see async-collector-selection, prefer-async-parallelism); weigh payload + lock/cursor cost (see data-size-extensibility). Name the choice — unexamined N+1 is the default bug.
- TIMEOUT: declared on queries/transactions so a hung query can't block the path (see wrap-unsafe-language-apis); name its consequence.
- RETRY: idempotent? (see unique-identifiers-confirmed) Retryable vs not, with backoff; never blindly retry non-idempotent writes.
- FAST-FAIL: permanent errors (validation, auth/forbidden, not-found) fail fast, no retry loop — that's a hang (see deliberate-error-handling).
- WHY: DB access is where round-trip, hang, and unsafe-retry failures concentrate; naming makes each auditable.
- TIES: unique-identifiers-confirmed, async-collector-selection, deliberate-error-handling, data-size-extensibility, wrap-unsafe-language-apis, prefer-async-parallelism, hot-code-precompiled-hooks, strict-review-standards.
- DON'T OVER-APPLY: hot/risky paths only (see hot-code-precompiled-hooks); cold reads without retry need one line.
