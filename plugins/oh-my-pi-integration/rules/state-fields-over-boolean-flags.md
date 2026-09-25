---
name: state-fields-over-boolean-flags
description: "For data structures with boolean fields, consider a state-machine field when the booleans encode mutually-exclusive states or combinations — one state field beats N boolean flags that must be added and kept in sync on every transition; keep genuinely binary booleans as-is. Deliberate number vs string representation: strings read cleaner, numbers index faster"
condition: ["^(?=[\\s\\S]*boolean|bool flag|flags?)(?=[\\s\\S]*is[A-Z]|has[A-Z])(?=[\\s\\S]*is(Active|Enabled|Paused|Archived|Locked|Closed|Open|Done|Valid|Failed|Pending|Paid|Refunded))(?=[\\s\\S]*state machine|enum(eration)?|state field)(?=[\\s\\S]*mutually exclusive)(?=[\\s\\S]*combination(s)?[\\s\\S]{0,40}?(state|flag|boolean))(?=[\\s\\S]*status field)"]
scope: ["text", "thinking"]
---

For data structures with boolean fields, consider a state-machine field (number/string/enum) when the booleans encode mutually-exclusive states or combinations. A consider, not a ban.

THE SIGNAL: multiple flags encoding phases of ONE evolving property — mutually exclusive or ordered/combinable = a state machine in boolean clothing. The tell: consistency needs an invariant nothing enforces — declare it.

WHY ONE STATE FIELD WINS:
- A new state = one enum member, not a boolean plus combination sync.
- Illegal combinations stop compiling — type-enforced (see strict-types-and-reuse), not a silent runtime invariant.
- A versioned `status` evolves additively; a boolean explosion needs a field per state plus consumer sync (see api-schema-versioning).

WHEN BOOLEANS ARE HONEST: two-state independent fields stay booleans. The rule bites only on mutually-exclusive or combination-heavy clusters.

DELIBERATE THE REPRESENTATION — number vs string:
- STRINGS: self-documenting — reads in logs/debugging. Cost: heavier storage, slower comparisons/indexing; prefer literal-union types (compile-time typo safety).
- NUMBERS/ENUMS/MAPS: compact, cheap equality. Cost: opaque — needs a named mapping; bare numbers are magic values (see wiring-sync-and-consolidation).
- DECIDE BY where it lives and how it's consumed:
  - Database: numeric indexes/stores smaller; strings keep the DB self-describing; use native enum/CHECK and project convention.
  - Hot paths, large datasets, wire-size-sensitive payloads → numeric, mapping named and shared.
  - Developer-facing machines, logs, small cardinality → strings; optimize only when measured.
  - ONE CANONICAL REPRESENTATION: pick one, map at boundaries — no dual numeric+string truth (it drifts; see wiring-sync-and-consolidation).
- State the representation and reason; don't pick by inertia.

DON'T OVER-APPLY:
- One boolean with no state neighbors stays; converting adds noise.
- Persisted boolean→state-field is a breaking shape change — versioned migration, not silent (see api-schema-versioning).
- "Only X" tasks don't refactor far-side state representation (see wiring-sync-and-consolidation).
