---
name: frontend-backend-validation
description: "Validate on BOTH frontend and backend: the frontend is not reliable (modifiable/hackable, not a security boundary) but still validates to avoid sending unsatisfiable requests; API/DB validation is the authoritative boundary, done by default unless an explicitly-stated fast prototype"
condition: ["^(?=[\\s\\S]*frontend|client|browser|ui|form|input (field)|client-side)(?=[\\s\\S]*validation|validate|constraint|required (field)|format check)(?=[\\s\\S]*backend|server|api|db|server-side)(?=[\\s\\S]*prototype|rapid (development|prototype)|spike|proof of concept|poc)"]
scope: ["text", "thinking"]
---

Validate on BOTH frontend and backend, each for its own reason — never frontend-only, and never trusting the frontend.

THE RULE — division of labor:
- FRONTEND VALIDATION (UX + early feedback): validates to avoid sending requests that cannot be satisfied — required fields, format, length — giving fast feedback without a round trip. This is NOT a security boundary: the frontend can be modified/hacked in place, so it is never trusted for enforcement.
- BACKEND/API/DB VALIDATION (the authoritative boundary): the real enforcement that rejects bad input at the API and DB, BY DEFAULT (see api-input-validation, sql-injection-free). The backend never assumes the frontend validated — confirm it validates independently; a frontend-only check the backend trusts is a bug.
- SAME RULES, TWO IMPLEMENTATIONS: wherever possible both sides enforce the same constraints (they are duplicated by necessity — the frontend copy is UX, the backend copy is truth). Mismatch is a bug: a field the backend accepts but the frontend blocks (and vice versa) breaks the contract (see wiring-sync-and-consolidation, api-schema-versioning).
- PROTOTYPE EXCEPTION: for a fast prototype (spike, proof of concept), backend/API/DB validation MAY be deferred — but STATE that this is a prototype shortcut and name what must be added before real use (see documentation-and-planning-audit). The deferral is explicit, never silent.

WHY: frontend-only validation is bypassable (security + correctness), backend-only validation couples UX to a round trip and clobbers fields the user could have fixed first. Both, for distinct reasons, is the correct default — and the rule names the one legitimate exception (prototype) so it is not silently permanent.

TIES: api-input-validation, authorization-confirmed, sql-injection-free, api-idempotency, wiring-sync-and-consolidation, documentation-and-planning-audit.

DON'T OVER-APPLY: not every field needs heavy frontend validation — validate what prevents unsatisfiable requests and gives real feedback. And the prototype exception is for throwaway prototypes; a shipping feature without backend validation is a bug.
