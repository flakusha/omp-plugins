---
name: unique-identifiers-confirmed
description: "For API, DB access implementations — confirm unique ids are used: collision-safe identity for every stored record, idempotency keys for retryable writes, and unguessable/opaque ids where exposure matters"
condition: ["^(?=[\\s\\S]*unique id|uuid|guid|idempoten|primary key|identity|collision|enumerable)(?=[\\s\\S]*create (a )?(record|row|entity|resource)|insert|add (a )?new|generate (an )?id|upsert)(?=[\\s\\S]*api|database|db|table|collection|data store)"]
scope: ["text", "thinking"]
---

For API, DB-access and data-storage implementations, CONFIRM unique ids are actually used — identify and record the identity scheme before/while building.

THE RULE — check each:
- COLLISION-SAFE IDENTITY: every stored record has a true unique id — a DB primary key (serial/identity/auto-increment) or an application-generated UUID — NOT something derived from user-supplied or mutable data (a name, email, natural key) that can collide or silently change identity. Uniqueness must be enforced by a DB constraint, not by an app-level "check-then-insert" (that races — TOCTOU — see parallel-safe-tests for the same race class).
- IDEMPOTENCY KEYS: for write operations that may be retried (see db-access-performance, async-collector-selection), confirm an idempotency key exists so a duplicate retry cannot double-apply. Retrying a write without idempotency is a correctness bug, not a nicety.
- EXTERNAL EXPOSURE: where a resource is exposed publicly, confirm the id is opaque and unguessable (UUID over sequential ints) when enumerability is a concern. And never rely on an unguessable id AS authorization — see authorization-confirmed: an unguessable id must still be access-checked (IDOR is a top API vulnerability).

WHY: identity is the foundation of correctness (which record), idempotency (how many times applied), and security (which resource is reachable). A broken or absent identity scheme fails silently across all three.

TIES: authorization-confirmed (IDOR — unguessable ≠ authorized), db-access-performance (idempotency on retry), async-collector-selection (retry under idempotency constraints), forward-compatible-datastructures, strict-review-standards.

DON'T OVER-APPLY: a serial PK is a valid unique id — the rule is "confirm uniqueness and its guarantees", not "mandate UUIDs everywhere". Read-only caches or reports may key on natural keys only when they are genuinely unique and immutable; confirm that before relying on it.
