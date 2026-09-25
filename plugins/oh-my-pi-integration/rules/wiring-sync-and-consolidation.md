---
name: wiring-sync-and-consolidation
description: "When work touches layer boundaries (frontend/backend, client/server, code/DB), update and validate wirings of calls and endpoints on both sides; unless the task explicitly scopes to one layer (only frontend/db/backend/...), recommend consolidation: dedupe magic values and type unions, and derive types from live classes, data structures, or schema"
condition: ["^(?=[\\s\\S]*(frontend|backend|client|server|API|endpoint|route|DB|schema))(?=[\\s\\S]*(sync|wire|call|contract))(?=[\\s\\S]*wire(d)? (up|the)?)(?=[\\s\\S]*call)(?=[\\s\\S]*endpoint)(?=[\\s\\S]*only (frontend|backend|db|database|client|server|api))(?=[\\s\\S]*magic value|hardcod|string literal|inline (type|union))(?=[\\s\\S]*type union|duplicat(ed|e) type)(?=[\\s\\S]*(derive|infer|generated)[\\w ]{0,24}type)"]
scope: ["text", "thinking"]
---

Cross-layer work keeps both wiring sides in sync; consolidate unless explicitly scoped to one layer.

VALIDATE WIRINGS (on boundary work):
- Every call site matches its endpoint (method/path/params/shape); every changed endpoint updates its callsites — one-sided sync is incomplete.
- Check the existing pattern first (shared API client, generated contracts, typed handlers, ORM schema ↔ data access); follow it, no parallel convention.

SCOPE: a named layer → respect it, don't expand (flag far-side mismatches, change nothing); unscoped → consolidate

CONSOLIDATE (ONE source of truth from live structure, never hand-maintained):
- MAGIC VALUES: repeated literals (status codes, config strings, IDs, thresholds, flags) → named constants, one source, imported as needed
- TYPE UNIONS: scattered `'a' | 'b' | 'c'` unions → one shared type imported everywhere; a union is a contract, duplicates drift.
- LIVE TYPES: API responses → contract types (OpenAPI/codegen, shared package, contracts-first); DB schema → ORM types (Prisma/Drizzle); live classes → `typeof`/`satisfies`/inference; follow the project's pattern, never hand-written parallels.
