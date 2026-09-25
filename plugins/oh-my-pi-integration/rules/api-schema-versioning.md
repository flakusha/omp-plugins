---
name: api-schema-versioning
description: "Recommend versioning at compatibility boundaries: path/namespace versioning for APIs (/v1/...) and explicit version markers (version field or versioned names) for DB schemas, data structures, classes, types — additive migrations, parallel evolution, easy deprecations; never mutate an existing version's contract"
condition: ["^(?=[\\s\\S]*(API|endpoint|route|REST|gRPC|GraphQL|service))(?=[\\s\\S]*(version(ed|ing)?|v\\d+))(?=[\\s\\S]*version(ed|ing)?)(?=[\\s\\S]*(API|endpoint|route|schema|data structure|class|type))(?=[\\s\\S]*/v\\d+/|v\\d+/)(?=[\\s\\S]*db schema|database schema|data structure)(?=[\\s\\S]*migrat(ion|e)?)(?=[\\s\\S]*deprecat(ion|e|ed)?)(?=[\\s\\S]*backward compat(ibility)?)(?=[\\s\\S]*breaking change)"]
scope: ["text", "thinking"]
---

Version the compatibility boundaries: APIs get path/namespace versioning (`/v1/...`); DB schemas/data structures/classes/types get explicit markers (`version` field, or names like `UserV1` when the shape changes). Payoff: additive migrations, extensions as new versions not mutations, cheap deprecations (announce + keep alive + retire; rollback = point at previous version). Without versioning, "deprecation" is a breaking change in disguise.

- APIs: NEVER mutate an existing version's contract — changes land in a NEW version; the old stays live through a deprecation window, then retires.
- Persisted structures: explicit `version` field; migrations read it and upgrade in place or branch. Old rows without it are version 1.
- Classes / types: versioned names when the public shape changes; old one deprecated but present during transition. Derive shapes from the live source of truth (see strict-types-and-reuse).
- FOLLOW THE PROJECT'S PATTERN — never invent a parallel scheme.

DON'T OVER-APPLY (recommendation, not mandate): no ceremony for internal-only helpers or boundaries without external consumers; no `version` field without an evolution plan; respect layer scope (see wiring-sync-and-consolidation); version only public APIs, persisted schemas, shared type contracts.
