---
name: object-shape-validation
description: "For untyped/deserialized data — apply object shape validation and estimate/confirm the runtime type(s) before relying on the object's fields"
condition: ["^(?=[\\s\\S]*\\bjson\\b|deserializ|untyped|dynamic (data|object)|\\bunknown\\b|parsed (object|data)|api (response|payload)|config (file|object)|wire format)(?=[\\s\\S]*shape (validation|check)|validate the shape|field (presence|type|shape))(?=[\\s\\S]*\\btypeof\\b|instanceof|type guard|estimate (the )?type|\\bas\\b cast|satisfies|structural (check|validation))"]
scope: ["text", "thinking"]
---

Untyped objects — deserialized JSON, API responses, configs, `unknown`/`any` — get shape validation + ESTIMATE/CONFIRM runtime types before field access.
- VALIDATE THE SHAPE: fields, types, nesting via type guard/schema validator — via the reused validation layer if any (see api-input-validation).
- ESTIMATE/CONFIRM RUNTIME TYPES: typeof/instanceof/type guard (see wiring-sync-and-consolidation), not the static type — avoids `any`-escape handling (see strict-types-and-reuse).
- SHALLOW TRAP: "property exists" is not enough — value may be wrong type/shape; detect and handle (see boundary-value-handling).
- Unchecked untyped fields crash or silently corrupt.
WHY: an untyped object is an unverified contract — trusting its shape = trusting an unsourced claim (see verify-api-actuality).
TIES: api-input-validation, strict-types-and-reuse, wiring-sync-and-consolidation, boundary-value-handling, verify-api-actuality, prefer-repo-json-buffer-wrappers.
DON'T OVER-APPLY: compile-time-typed, trusted data needs no runtime re-validation — boundaries only.
