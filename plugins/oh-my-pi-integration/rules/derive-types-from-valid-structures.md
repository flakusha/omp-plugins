---
name: derive-types-from-valid-structures
description: "TypeScript — derive types from valid const structures and reuse them (as const + typeof array[number]), avoiding parallel datastructure/interface/type/schema definitions that must be kept in sync"
condition: ["typescript|\\bts\\b|types?", "as const|typeof (array|object|structure|owo|foo)|\\[number\\]|literal (union|type)|derive (type|types)|compil(e|ing) (type|types)", "interface|schema|type alias|duplicate (type|schema|interface)|keep in sync|\\bDRY\\b"]
scope: ["text", "thinking"]
---

In TypeScript, DERIVE types from valid literal structures and REUSE them, instead of maintaining parallel datastructure/interface/type/schema definitions that must be kept in sync.

THE RULE:
- DERIVE FROM A SINGLE SOURCE: define the valid values ONCE as data, then derive the type. `const owo = ['a','b','c'] as const; type owoT = typeof owo[number];` is the canonical pattern. The type and the runtime values come from ONE structure, so they cannot drift.
- REUSE EVERYWHERE: use the derived type in signatures, interfaces, and schemas rather than re-declaring an equivalent union/string-literal elsewhere. One valid structure feeding type + validation + UI options keeps everything consistent (see strict-types-and-reuse: reuse the existing type; avoid duplication).
- THIS IS THE FIX for "datastructure + interface + type + schema + …": parallel definitions are drift risk. Consolidate so ONE valid structure is the source of truth, typed by `typeof`/`satisfies` (see wiring-sync-and-consolidation: the two-sided check; see forward-compatible-datastructures: one structure, extras handled once).
- MECHANICS: `as const` yields literal types (not widened `string`), enabling exact unions; `typeof x[number]` extracts the element union; `satisfies` checks the structure stays assignable to a wider type while keeping the precise derived type.

WHY: compiling types from the actual valid structure eliminates the "type says X, runtime data says Y" drift class — the type literally cannot disagree with the structure it was derived from.

TIES: strict-types-and-reuse, wiring-sync-and-consolidation, object-shape-validation, forward-compatible-datastructures, api-schema-versioning, frontend-search-filter-consideration (share option values/types with the backend).

DON'T OVER-APPLY: not every type is derivable from a literal — complex object/interface shapes that do not reduce to a const structure still need explicit declarations. The rule targets valid-value sets and simple shapes where a const + `typeof` derivation removes genuine duplication.
