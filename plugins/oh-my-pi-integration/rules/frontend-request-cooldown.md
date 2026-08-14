---
name: frontend-request-cooldown
description: "Frontend — decide the retry/cooldown UX explicitly for mutating actions: active cooldown, element disabled/unavailable after the request is sent, and defined reactivation (on response, on failure, or terminal)"
condition: ["(?=[\\s\\S]*frontend|client|ui|button|form (submit|submission)|click (handler)|double (click|submit)|spinner|disabled)(?=[\\s\\S]*request (sent|in flight)|cooldown|debounce|throttle|in progress|waiting (for|on) (response|server))(?=[\\s\\S]*mutat|submit|save|send|create|post|apply)"]
scope: ["text", "thinking"]
---

For mutating frontend actions, decide the retry/cooldown UX EXPLICITLY — this is defense-in-depth + UX, never the only guard (the backend must still be idempotent; see api-idempotency).

THE RULE — name each transition:
- COOLDOWN: determine whether an active cooldown (debounce/throttle) is enabled to prevent duplicate submission on rapid clicks.
- ELEMENT UNAVAILABLE AFTER SEND: once the request is sent, the triggering element is disabled/unavailable (disabled state, spinner) so the user cannot re-submit while it is in flight.
- REACTIVATION IS DEFINED: state exactly when the element reactivates — on response acquired (success), on failure (retry allowed?), or permanently for a terminal state. Name every transition, not just "disable it".
- NEVER THE ONLY GUARD: the frontend cooldown does not provide idempotency — the client can be replayed or circumvented (see frontend-backend-validation: the frontend is not reliable), so the backend mutation must be idempotent regardless.

WHY: an unguarded double-submit corrupts data even when the backend is correct, and a permanently-stuck disabled element (reactivation never defined) is a UX bug. Explicit cooldown/disable/reactivation semantics make both the UX and the failure modes reviewable.

TIES: api-idempotency, frontend-backend-validation, deliberate-error-handling, prefer-async-parallelism.

DON'T OVER-APPLY: not every action needs a cooldown — idempotent/read-only actions (GET-like) need no disable logic. The discipline applies to mutating actions where duplicate submission is plausible (forms, submit/save buttons, payment-like actions).
