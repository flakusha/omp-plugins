---
name: state-fields-over-boolean-flags
description: "For data structures with boolean fields, consider a state-machine field when the booleans encode mutually-exclusive states or combinations — one state field beats N boolean flags that must be added and kept in sync on every transition; keep genuinely binary booleans as-is. Deliberate number vs string representation: strings read cleaner, numbers index faster"
condition: ["(?=[\\s\\S]*boolean|bool flag|flags?)(?=[\\s\\S]*is[A-Z]|has[A-Z])(?=[\\s\\S]*is(Active|Enabled|Paused|Archived|Locked|Closed|Open|Done|Valid|Failed|Pending|Paid|Refunded))(?=[\\s\\S]*state machine|enum(eration)?|state field)(?=[\\s\\S]*mutually exclusive)(?=[\\s\\S]*combination(s)?.*(state|flag|boolean))(?=[\\s\\S]*status field)"]
scope: ["text", "thinking"]
---

For data structures with boolean fields, consider a state-machine field (number, string, enum) instead of boolean flags when the booleans encode mutually-exclusive states or combinations. This is a "consider", not a blanket ban — the decision follows the field's nature.

THE SIGNAL — booleans that are really states:
- Multiple flags that encode phases of ONE evolving property: `isDraft` / `isActive` / `isArchived`, or `isPending` / `isPaid` / `isRefunded`. If the flags are mutually exclusive (at most one true) or represent ordered/combinable states, they are a state machine wearing boolean clothing.
- The tell: keeping them consistent requires an invariant ("exactly one true", "can't be both Active and Archived") that nothing enforces. That invariant is the state machine you should just declare.

WHY A SINGLE STATE FIELD WINS:
- A new state = ONE new enum member (`status: 'active' | 'paused' | 'archived'`), not a new boolean PLUS keeping every combination consistent.
- Transitions and combinations become explicit and legal-only: an illegal combination (`isActive && isArchived`) stops compiling, enforced by the type system (see strict-types-and-reuse) instead of being a silent runtime invariant nobody maintains.
- Migration and deprecation are cheaper: a versioned `status` field evolves additively, where a boolean explosion would need a new field per state and a sync pass over every consumer (see api-schema-versioning).

WHEN BOOLEANS ARE HONEST — LEAVE THEM:
- Truly two-state, independent fields stay booleans: `enabled`, `visible`, `hasPermission`, `isPresent`. Forcing an enum onto a genuine binary is ceremony with no payoff.
- The rule only bites when booleans are mutually exclusive or combination-heavy — evaluate each cluster on its own.

DELIBERATE THE REPRESENTATION — number vs string:
- STRINGS (literal unions, string enums): self-documenting state intent — `status: 'active' | 'paused'` reads correctly in logs, serialized output, and debugging without a decoder. Cost: heavier — larger storage, slower comparisons and indexing, and typo risk (eliminated at compile time by literal-union types, so prefer those over raw strings).
- NUMBERS / ENUMS / MAPS (numeric): memory-efficient and fast — compact storage, cheap equality, fast indexing, smaller wire format. Cost: opaque — every value needs a named mapping (enum object, const map, DB enum/lookup) to be readable, and bare numbers without a mapping are just magic values (see wiring-sync-and-consolidation).
- DECIDE BY: where the value lives and how it is consumed.
  - Database: numeric enums index faster and store smaller; string enums keep the DB self-describing. Use the DB's native enum/CHECK support either way; follow the project's existing convention.
  - Hot paths, large datasets, or wire-size-sensitive payloads → numeric, with the mapping named and shared.
  - Developer-facing state machines, logs, debugging, small cardinality → strings (typed unions) are the right default for clarity; optimize only when measured, not pre-emptively.
  - ONE CANONICAL REPRESENTATION: pick one and map at boundaries if needed. Do not keep both a numeric and a string truth in the domain layer — a dual source of truth drifts (see wiring-sync-and-consolidation).
- The choice is deliberate either way: state the representation and the reason in the change; do not pick one by inertia.

DON'T OVER-APPLY:
- One boolean with no state neighbors is fine; converting it adds noise.
- If the structure is persisted, boolean→state-field is a breaking shape change — do it as a versioned migration, not silently (see api-schema-versioning).
- Respect layer scope: "only X" tasks do not refactor state representation on the far side (see wiring-sync-and-consolidation).
