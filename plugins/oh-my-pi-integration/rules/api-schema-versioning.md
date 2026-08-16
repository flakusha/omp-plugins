---
name: api-schema-versioning
description: "Recommend versioning at compatibility boundaries: path/namespace versioning for APIs (/v1/...) and explicit version markers (version field or versioned names) for DB schemas, data structures, classes, types — additive migrations, parallel evolution, easy deprecations; never mutate an existing version's contract"
condition: ["^(?=[\\s\\S]*(API|endpoint|route|REST|gRPC|GraphQL|service))(?=[\\s\\S]*(version(ed|ing)?|v\\d+))(?=[\\s\\S]*version(ed|ing)?)(?=[\\s\\S]*(API|endpoint|route|schema|data structure|class|type))(?=[\\s\\S]*/v\\d+/|v\\d+/)(?=[\\s\\S]*db schema|database schema|data structure)(?=[\\s\\S]*migrat(ion|e)?)(?=[\\s\\S]*deprecat(ion|e|ed)?)(?=[\\s\\S]*backward compat(ibility)?)(?=[\\s\\S]*breaking change)"]
scope: ["text", "thinking"]
---

Version the compatibility boundaries: APIs get path/namespace versioning (`/v1/...`, `/api/v1/...`), and DB schemas, data structures, classes, and types get explicit version markers (a `version` field on persisted/structured data, or versioned names like `UserV1`/`UserV2` where the shape itself changes). Versioning at the boundary pays for itself three ways:

- SIMPLER MIGRATIONS: changes become additive. Old records keep parsing (schema version field), old clients keep working (old API path) while the new version rolls out — you migrate forward, not atomically.
- EASIER FUTURE EXTENSIONS: a new shape is a new version, not a mutation of the old one. Consumers who never opted in are unaffected.
- EASY DEPRECATIONS: deprecate = announce + keep alive + retire. Rollback = point at the previous version. Without versioning, "deprecation" is a breaking change in disguise.

HOW:
- APIs: version is part of the contract (path prefix or the project's existing namespace convention). NEVER mutate an existing version's contract — changed behavior lands in a NEW version; the old version stays live through a deprecation window, then is retired.
- DB schemas / persisted structures: explicit `version` field on records; migrations read the version and upgrade in place or branch by it. Old rows without the field are version 1.
- Classes / types: versioned names or namespaces when the public shape changes (`UserV1` → `UserV2`), with the old one deprecated but present during transition. Prefer deriving shapes from the live source of truth (see strict-types-and-reuse).
- FOLLOW THE PROJECT'S PATTERN: use whatever the project already uses (path prefixes, header/version negotiation, schema version columns, codegen'd types). Do not invent a parallel versioning scheme.

DON'T OVER-APPLY (this is a recommendation, not a mandate):
- Do not version everything: internal-only helpers, throwaway code, and boundaries with no external consumers get no version ceremony.
- Do not add a `version` field with no evolution plan — a version marker with no migration path is dead weight.
- Respect layer scope: if the task explicitly says "only frontend"/"only db", do not introduce versioning on the far side (see wiring-sync-and-consolidation).
- Version where compatibility actually matters: public APIs, persisted schemas, shared type contracts. Those are the boundaries that make migrations, extensions, and deprecations cheap.
