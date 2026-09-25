---
name: derive-types-from-valid-structures
description: "TypeScript — derive types from valid const structures and reuse them (as const + typeof array[number]), avoiding parallel datastructure/interface/type/schema definitions that must be kept in sync"
condition: ["^(?=[\\s\\S]*typescript|\\bts\\b|types?)(?=[\\s\\S]*as const|typeof (array|object|structure|owo|foo)|\\[number\\]|literal (union|type)|derive (type|types)|compil(e|ing) (type|types))(?=[\\s\\S]*interface|schema|type alias|duplicate (type|schema|interface)|keep in sync|\\bDRY\\b)"]
scope: ["text", "thinking"]
---

In TypeScript, DERIVE types from valid literal structures and REUSE them — never maintain parallel datastructure/interface/type/schema definitions.

- ONE SOURCE: `const owo = ['a','b','c'] as const; type owoT = typeof owo[number];` — type and runtime values cannot drift.
- REUSE EVERYWHERE: the derived type in signatures, interfaces, schemas — one structure feeding type + validation + UI options (see strict-types-and-reuse).
- THE FIX for "datastructure + interface + type + schema": consolidate to one valid structure typed by `typeof`/`satisfies` (see wiring-sync-and-consolidation, forward-compatible-datastructures).
- MECHANICS: `as const` = literal types; `typeof x[number]` = element union; `satisfies` = wider check, precise type kept.
- WHY: eliminates the "type says X, runtime says Y" drift class.
- TIES: strict-types-and-reuse, wiring-sync-and-consolidation, object-shape-validation, forward-compatible-datastructures, api-schema-versioning, frontend-search-filter-consideration.
- DON'T OVER-APPLY: complex shapes that don't reduce to a const still need explicit declarations.
