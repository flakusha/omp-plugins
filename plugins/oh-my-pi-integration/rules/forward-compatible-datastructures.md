---
name: forward-compatible-datastructures
description: "When designing data structures that mirror or participate in external contracts (specs, protocols, wire formats), link the existing spec/implementation, continue implementing, add TODOs at anticipated expansion points, and consider an extras catch-all (Record<string, unknown> in TS, flatten map in Rust, dict in Python, map in Go) for structures involved in external communication — unless a strong performance constraint forbids it"
condition: ["^(?=[\\s\\S]*data structure|datastructure|(type|class|model|schema)[\\s\\S]{0,40}?(extend|forward|future))(?=[\\s\\S]*extras|Record<[\\s\\S]{0,40}?unknown|unknown field|extra field|flatten)(?=[\\s\\S]*spec link|reference implementation|RFC|wire format|protocol)(?=[\\s\\S]*TODO[\\s\\S]{0,40}?(spec|extend|future|expand))(?=[\\s\\S]*external communication|external (system|service|api)|message type)(?=[\\s\\S]*forward.compat|extensib)"]
scope: ["text", "thinking"]
---

For a structure mirroring an external contract (spec, protocol, wire format, API payload): link the reference, implement the current contract, leave escape hatches.

- LINK THE SPEC: spec-derived structures get a comment linking the spec URL/reference implementation (see verify-api-actuality, research-before-complex-build). Continue implementing; the link documents, not blocks.

- TODOs AT EXPANSION POINTS: add a TODO at each anticipated expansion point naming the change and trigger — `// TODO(spec): extend payload union when v1.3 lands`.

- EXTERNAL COMMUNICATION ⇒ EXTRAS CATCH-ALL: boundary types are not under your control and WILL evolve; strict types break on the first unknown field:
- TS: `extras: Record<string, unknown>`
- Rust: `#[serde(flatten)] extras: HashMap<String, serde_json::Value>`
- Python: `extras: dict[str, Any]`
- Go: `Extra map[string]any`

WHY: unknown fields land in `extras`, not fail the parse; the structure survives evolution. LIFECYCLE: promote proven fields to typed fields — extras absorbs the frontier (additive-migration complement of api-schema-versioning).

USE `unknown`/`Value`/`Any`, NEVER `any` (see strict-types-and-reuse) — a typed boundary, not a hole.

UNLESS STRONG PERF CONSTRAINT (hot path, massive payloads, memory-bound): skip extras, document the decision (see hot-code-datastructure-todos), keep the TODO for when it lifts.

DON'T OVER-APPLY: internal-only, fully-owned structures get NO extras — dead weight that makes typos legal fields.
