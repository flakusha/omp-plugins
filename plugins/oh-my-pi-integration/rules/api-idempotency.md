---
name: api-idempotency
description: "For APIs that may be called multiple times and modify DB state — idempotency is required: fast cached response for repeated idempotency keys, insert-if-absent DB pattern, safe overwrite OR fast-fail with success/failure handling, and treat empty/partial/broken responses as distinct from communication/query errors"
condition: ["^(?=[\\s\\S]*idempoten|repeat|duplicate (request|call|submission)|called multiple times|at (least )?once|replay)(?=[\\s\\S]*api|endpoint|mutat(ing|ion)|modif(y|ies) (db|database|state)|create|submit|apply|save)(?=[\\s\\S]*cache|cached|overwrite|insert if (not )?exists|upsert|on conflict)(?=[\\s\\S]*empty (response|result)|partial (response|result|write)|broken response|malformed (response|result))"]
scope: ["text", "thinking"]
---

Duplicate paths (double-click, client retry, network replay) on state-modifying APIs are REQUIRED to be explicit, not emergent:

- FAST CACHED RESPONSE: repeated request returns the first execution's cached result, keyed by idempotency key (see unique-identifiers-confirmed) — no re-modification of state.
- INSERT-IF-ABSENT: `ON CONFLICT DO NOTHING` / `INSERT … WHERE NOT EXISTS` / unique constraint + upsert — a retry cannot create a second row. Confirm the write pattern is idempotent before relying on it.
- SAFE OVERWRITE OR FAST-FAIL: on conflict, EITHER an idempotent upsert (where overwrite is correct) OR fast-fail with explicit success/failure handling (see db-access-performance: fast-fail; deliberate-error-handling: handle-or-propagate, never swallow). Name what the duplicate path does — silent double-apply and silent ignore are both bugs.
- RESPONSE SHAPES: empty/partial/broken-malformed responses are distinct from communication/query errors — classify retryable vs permanent (see db-access-performance: transient vs permanent); partial/broken ≈ corruption signal, not retryable blip (see encryption-compression-round-trip: round-trip integrity).

WHY: a non-idempotent mutation under retry is corruption by duplicate application; an explicit duplicate path (cache / insert-if-absent / overwrite-or-fast-fail / response classification) removes the whole class.

TIES: unique-identifiers-confirmed (idempotency keys), db-access-performance (retry/fast-fail), deliberate-error-handling, async-collector-selection (retry under idempotency), api-input-validation, frontend-backend-validation.

DON'T OVER-APPLY: a single-shot transactional write behind a real DB constraint may need only the constraint; but if retries are plausible, idempotency is required, not a nicety.
