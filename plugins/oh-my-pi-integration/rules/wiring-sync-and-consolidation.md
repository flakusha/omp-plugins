---
name: wiring-sync-and-consolidation
description: "When work touches layer boundaries (frontend/backend, client/server, code/DB), update and validate wirings of calls and endpoints on both sides; unless the task explicitly scopes to one layer (only frontend/db/backend/...), recommend consolidation: dedupe magic values and type unions, and derive types from live classes, data structures, or schema"
condition: ["^(?=[\\s\\S]*(frontend|backend|client|server|API|endpoint|route|DB|schema))(?=[\\s\\S]*(sync|wire|call|contract))(?=[\\s\\S]*wire(d)? (up|the)?)(?=[\\s\\S]*call)(?=[\\s\\S]*endpoint)(?=[\\s\\S]*only (frontend|backend|db|database|client|server|api))(?=[\\s\\S]*magic value|hardcod|string literal|inline (type|union))(?=[\\s\\S]*type union|duplicat(ed|e) type)(?=[\\s\\S]*(derive|infer|generated)[\\w ]{0,24}type)"]
scope: ["text", "thinking"]
---

Cross-layer work: keep both wiring sides in sync; consolidate unless explicitly scoped to one layer.

VALIDATE THE WIRINGS (always on boundary work):
- Every call site matches its endpoint (method/path/params/shapes); every changed endpoint updates all call sites — one-sided change is incomplete.
- Check the existing pattern first (shared API client, generated contracts, typed route handlers, ORM schema ↔ data access); follow it, no parallel convention.

SCOPE: one layer named → respect it, don't expand; far-side mismatches get flagged, not changed. Unscoped → consolidate below.

CONSOLIDATE (invariant: ONE source of truth from live structure, never hand-maintained duplicates):
- MAGIC VALUES: repeated literals (status codes, config strings, IDs, thresholds, flags) → named constants; one source, imported as needed.
- TYPE UNIONS: scattered `'a' | 'b' | 'c'` inline unions → one shared type imported everywhere; unions are contracts; duplicates drift.
- LIVE TYPES: API responses → contract types (OpenAPI/codegen, shared types package, contracts-first); DB schema → ORM-generated (Prisma/Drizzle); live classes → `typeof`/`satisfies`/inference; follow the project's pattern; never a hand-written parallel type.
