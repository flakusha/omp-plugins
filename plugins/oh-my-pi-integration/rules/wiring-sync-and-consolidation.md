---
name: wiring-sync-and-consolidation
description: "When work touches layer boundaries (frontend/backend, client/server, code/DB), update and validate wirings of calls and endpoints on both sides; unless the task explicitly scopes to one layer (only frontend/db/backend/...), recommend consolidation: dedupe magic values and type unions, and derive types from live classes, data structures, or schema"
condition: ["(frontend|backend|client|server|API|endpoint|route|DB|schema).*(sync|wire|call|contract)", "wire(d)? (up|the)?", "call.*endpoint|endpoint.*call", "only (frontend|backend|db|database|client|server|api)", "magic value|hardcod|string literal|inline (type|union)", "type union|duplicat(ed|e) type", "derive.*type|infer.*type|generated type"]
scope: ["text", "thinking"]
---

Cross-layer work must keep both sides of every wiring in sync, and consolidation is expected unless the task explicitly limits itself to one layer.

VALIDATE THE WIRINGS (always, on boundary-crossing work):
- Every call site must match its endpoint: method, path, params, request/response shape. Every changed endpoint must have all call sites updated. Sync is a two-sided invariant — a change on one side without the other is incomplete.
- Check the project's existing wiring pattern first: shared API client, generated contracts, route handlers + typed request/response, ORM schema ↔ data access. Follow it; do not introduce a parallel convention.

SCOPE QUALIFIER:
- If the task explicitly names ONE layer ("only frontend", "only db", "only backend", "only X"): respect the boundary. Do not expand into other layers. You may still flag a mismatch you observe on the far side, but do not change it.
- If the task is NOT layer-scoped (cross-cutting or unspecified): it is expected to include the consolidation below.

CONSOLIDATION AND DEDUPLICATION (when not layer-scoped):
- MAGIC VALUES: repeated raw literals (status codes, config strings, IDs, thresholds, flags) become named constants / a single source of truth. One definition, imported where needed.
- TYPE UNIONS: repeated inline unions (`'a' | 'b' | 'c'` scattered across files) collapse into one shared type, imported everywhere it appears. The union is a contract — duplicate definitions drift.
- TYPE ESTIMATION FROM LIVE SOURCES: derive types from the live source of truth instead of maintaining hand-written duplicates that drift:
  - API response shapes → the actual runtime/contract types (OpenAPI/codegen, shared types package, contracts-first)
  - DB schema → ORM-generated types (Prisma/Drizzle/etc.), not parallel hand-written mirrors
  - Live classes / data structures → `typeof`, `satisfies`, or inference from the actual object
  - Follow the project's existing pattern for type generation; never invent a parallel hand-written type when a live one already exists.

Estimation is project-shaped: use whatever the project uses (contracts, schema, codegen, inference) — the invariant is ONE source of truth, derived from live structure, never a hand-maintained duplicate.
