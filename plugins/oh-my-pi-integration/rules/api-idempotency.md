---
name: api-idempotency
description: "For APIs that may be called multiple times and modify DB state — idempotency is required: fast cached response for repeated idempotency keys, insert-if-absent DB pattern, safe overwrite OR fast-fail with success/failure handling, and treat empty/partial/broken responses as distinct from communication/query errors"
condition: ["(?=[\\s\\S]*idempoten|repeat|duplicate (request|call|submission)|called multiple times|at (least )?once|replay)(?=[\\s\\S]*api|endpoint|mutat(ing|ion)|modif(y|ies) (db|database|state)|create|submit|apply|save)(?=[\\s\\S]*cache|cached|overwrite|insert if (not )?exists|upsert|on conflict)(?=[\\s\\S]*empty (response|result)|partial (response|result|write)|broken response|malformed (response|result))"]
scope: ["text", "thinking"]
---

For an API that may be called multiple times (user double-click, client retry, network replay) and modifies DB state, idempotency is REQUIRED — not optional. The duplicate path must be explicit, not emergent.

THE RULE — make each explicit:
- FAST CACHED RESPONSE: keyed by an idempotency key (see unique-identifiers-confirmed: generate + accept an idempotency key), a repeated request returns the cached result of the first successful execution instead of re-modifying state. Cache the response keyed by that key.
- PROPER DB ACCESS PATTERN: the mutation must be safe under duplicates — insert-if-absent (`ON CONFLICT DO NOTHING`, `INSERT … WHERE NOT EXISTS`, unique constraint + upsert) so a retry cannot create a second row. Confirm the write pattern is idempotent before relying on it.
- SAFE OVERWRITE OR FAST-FAIL: on conflict, EITHER perform a safe overwrite (an idempotent upsert where overwrite is correct) OR fast-fail with explicit success/failure handling (see db-access-performance: fast-fail path; see deliberate-error-handling: handle-or-propagate, never swallow). Name which the duplicate path does — silent double-apply and silent ignore are both bugs.
- RESPONSE-SHAPE HANDLING: an empty result, partial write, or broken/malformed response is NOT the same as a default communication/query error. Distinguish and handle them distinctly — retryable vs permanent (see db-access-performance: transient vs permanent); a partial/broken result is closer to a corruption signal than to a retryable network blip (see encryption-compression-round-trip: round-trip integrity).

WHY: a non-idempotent mutation under a retry or double-call is data corruption by duplicate application. Making the duplicate path explicit — cached response, insert-if-absent, safe-overwrite/fast-fail, and response-shape classification — removes the whole class instead of patching one duplicate.

TIES: unique-identifiers-confirmed (idempotency keys), db-access-performance (retry/fast-fail), deliberate-error-handling, async-collector-selection (retry under idempotency), api-input-validation, frontend-backend-validation.

DON'T OVER-APPLY: idempotency is required where a retry/double-call is plausible AND the mutation is non-trivial; a single-shot transactional write behind a real DB constraint may need only the constraint. But if the API is exposed to retries, treat idempotency as required, not a nicety.
