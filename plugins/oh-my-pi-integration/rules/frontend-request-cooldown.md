---
name: frontend-request-cooldown
description: "Frontend — decide the retry/cooldown UX explicitly for mutating actions: active cooldown, element disabled/unavailable after the request is sent, and defined reactivation (on response, on failure, or terminal)"
condition: ["^(?=[\\s\\S]*frontend|client|ui|button|form (submit|submission)|click (handler)|double (click|submit)|spinner|disabled)(?=[\\s\\S]*request (sent|in flight)|cooldown|debounce|throttle|in progress|waiting (for|on) (response|server))(?=[\\s\\S]*mutat|submit|save|send|create|post|apply)"]
scope: ["text", "thinking"]
---

Mutating actions: decide cooldown UX explicitly — defense-in-depth, never the only guard (backend idempotency required; see api-idempotency).

- COOLDOWN: debounce/throttle vs rapid re-clicks.
- DISABLED AFTER SEND: element disabled/spinner while in flight.
- REACTIVATION: state when: success, failure (retry?), never (terminal).
- NEVER THE ONLY GUARD: cooldown ≠ idempotency — clients can be replayed (see frontend-backend-validation); backend must be idempotent regardless.

WHY: double-submit corrupts data; a stuck disabled element is a UX bug — explicit transitions make both reviewable.

TIES: api-idempotency, frontend-backend-validation, deliberate-error-handling, prefer-async-parallelism.

DON'T OVER-APPLY: idempotent/read-only actions need none; mutating actions with plausible duplicates (forms, save, payments).
