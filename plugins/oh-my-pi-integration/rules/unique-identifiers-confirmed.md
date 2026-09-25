---
name: unique-identifiers-confirmed
description: "For API, DB access implementations — confirm unique ids are used: collision-safe identity for every stored record, idempotency keys for retryable writes, and unguessable/opaque ids where exposure matters"
condition: ["^(?=[\\s\\S]*unique id|uuid|guid|idempoten|primary key|identity|collision|enumerable)(?=[\\s\\S]*create (a )?(record|row|entity|resource)|insert|add (a )?new|generate (an )?id|upsert)(?=[\\s\\S]*api|database|db|table|collection|data store)"]
scope: ["text", "thinking"]
---

API/DB work: CONFIRM unique ids are actually used; name the identity scheme.

- COLLISION-SAFE: true unique id per record — DB PK (serial) or UUID, never user-supplied/mutable data (name/email/natural key); uniqueness by DB constraint, not check-then-insert (TOCTOU; see parallel-safe-tests).
- IDEMPOTENCY KEYS: retryable writes need one (see db-access-performance, async-collector-selection) — a retry must never double-apply; retrying without is a bug.
- EXTERNAL EXPOSURE: exposed ids opaque/unguessable (UUID over sequential) where enumerability matters; unguessable is not authorization (IDOR; see authorization-confirmed).

WHY: identity grounds correctness, idempotency, security — a broken scheme fails silently.

TIES: authorization-confirmed, db-access-performance, async-collector-selection, forward-compatible-datastructures, strict-review-standards.

DON'T OVER-APPLY: serial PKs are valid — confirm uniqueness, don't mandate UUIDs; natural keys OK for read-only caches/reports only if genuinely unique + immutable; confirm first.
