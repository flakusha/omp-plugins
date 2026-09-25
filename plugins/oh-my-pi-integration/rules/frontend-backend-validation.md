---
name: frontend-backend-validation
description: "Validate on BOTH frontend and backend: the frontend is not reliable (modifiable/hackable, not a security boundary) but still validates to avoid sending unsatisfiable requests; API/DB validation is the authoritative boundary, done by default unless an explicitly-stated fast prototype"
condition: ["^(?=[\\s\\S]*frontend|client|browser|ui|form|input (field)|client-side)(?=[\\s\\S]*validation|validate|constraint|required (field)|format check)(?=[\\s\\S]*backend|server|api|db|server-side)(?=[\\s\\S]*prototype|rapid (development|prototype)|spike|proof of concept|poc)"]
scope: ["text", "thinking"]
---

Validate BOTH frontend and backend, for distinct reasons — never frontend-only, never trusting it.

- FRONTEND (UX): required fields, format, length — fast feedback, no round trip. NOT security: modifiable, never trusted.
- BACKEND/API/DB (authoritative): enforcement, BY DEFAULT (see api-input-validation, sql-injection-free). Never assume the frontend validated.
- SAME RULES TWICE: frontend copy is UX, backend copy is truth; mismatch breaks the contract (see wiring-sync-and-consolidation, api-schema-versioning).
- PROTOTYPE EXCEPTION: MAY defer backend validation for prototypes — STATE the shortcut and what to add (see documentation-and-planning-audit).

WHY: frontend-only is bypassable; backend-only couples UX to a round trip and clobbers fixable fields — the named exception never becomes silent.

TIES: api-input-validation, authorization-confirmed, sql-injection-free, api-idempotency, wiring-sync-and-consolidation, documentation-and-planning-audit.

DON'T OVER-APPLY: validate only what prevents unsatisfiable requests or gives real feedback; the exception is for throwaway prototypes — shipping without backend validation is a bug.
