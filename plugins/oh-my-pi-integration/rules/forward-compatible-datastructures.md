---
name: forward-compatible-datastructures
description: "When designing data structures that mirror or participate in external contracts (specs, protocols, wire formats), link the existing spec/implementation, continue implementing, add TODOs at anticipated expansion points, and consider an extras catch-all (Record<string, unknown> in TS, flatten map in Rust, dict in Python, map in Go) for structures involved in external communication — unless a strong performance constraint forbids it"
condition: ["^(?=[\\s\\S]*data structure|datastructure|(type|class|model|schema)[\\s\\S]{0,40}?(extend|forward|future))(?=[\\s\\S]*extras|Record<[\\s\\S]{0,40}?unknown|unknown field|extra field|flatten)(?=[\\s\\S]*spec link|reference implementation|RFC|wire format|protocol)(?=[\\s\\S]*TODO[\\s\\S]{0,40}?(spec|extend|future|expand))(?=[\\s\\S]*external communication|external (system|service|api)|message type)(?=[\\s\\S]*forward.compat|extensib)"]
scope: ["text", "thinking"]
---

When designing a data structure that mirrors or participates in an external contract — a spec, protocol, wire format, API payload, or message type — design it forward-looking: link the existing reference, continue implementing the current contract, and leave escape hatches for evolution.

EXISTING IMPLEMENTATIONS ON THE NET: for spec-derived structures, an authoritative spec and often a reference implementation already exist. LINK THEM — the spec URL and/or reference implementation — as a comment on the type. The link is for the future maintainer who must verify actuality (see verify-api-actuality: specs change) and for the researcher (see research-before-complex-build: proven shapes exist). Continue implementing regardless; the link is documentation, not a blocker.

TODOs AT EXPANSION POINTS: potential future feature expansions will require updating the structure. Continue implementing the CURRENT contract, but add a TODO at each anticipated expansion point naming the future change and its trigger — e.g. `// TODO(spec): v1.3 adds batch variants — extend payload union when upstream lands`. The TODO turns a future breaking change into a located edit.

EXTERNAL COMMUNICATION ⇒ EXTRAS CATCH-ALL: if the structure will be sent to or received from an external party, its schema is NOT fully under your control and WILL evolve. Strict types reject unknown fields — the first forward-incompatible payload breaks parse/deserialize. Extend the type with a catch-all:
- TS: `extras: Record<string, unknown>`
- Rust: `#[serde(flatten)] extras: HashMap<String, serde_json::Value>`
- Python: `extras: dict[str, Any]`
- Go: `Extra map[string]any`

WHY: unknown fields land in `extras` instead of failing the parse, so the structure survives evolution — old parsers tolerate new fields, new fields stay accessible until promoted. THE LIFECYCLE: when a field proves permanent, promote it from `extras` to a first-class typed field; `extras` absorbs the frontier, first-class fields are the settled contract (the additive-migration complement of api-schema-versioning: versioning governs contract semantics, extras governs parse-time tolerance).

USE `unknown`/`Value`/`Any`, NEVER `any`-style escape hatches (see strict-types-and-reuse) — the whole point is a typed boundary, not a typed hole.

UNLESS STRONG PERFORMANCE CONSTRAINT: hot path, massive payload serialization, memory-constrained — then SKIP the extras, document the perf decision and reason (see hot-code-datastructure-todos: enforcement follows the measured need), and keep the TODO for when the constraint lifts.

DON'T OVER-APPLY: internal-only structures under full control do NOT get extras — a catch-all on a fully-owned type is dead weight and weakens it (typos become legal fields). Extras is for boundary types whose schema is controlled elsewhere.
