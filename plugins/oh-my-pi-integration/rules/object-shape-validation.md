---
name: object-shape-validation
description: "For untyped/deserialized data — apply object shape validation and estimate/confirm the runtime type(s) before relying on the object's fields"
condition: ["(?=[\\s\\S]*\\bjson\\b|deserializ|untyped|dynamic (data|object)|\\bunknown\\b|parsed (object|data)|api (response|payload)|config (file|object)|wire format)(?=[\\s\\S]*shape (validation|check)|validate the shape|field (presence|type|shape))(?=[\\s\\S]*\\btypeof\\b|instanceof|type guard|estimate (the )?type|\\bas\\b cast|satisfies|structural (check|validation))"]
scope: ["text", "thinking"]
---

Whenever an object arrives untyped — deserialized JSON, a dynamic API response, a parsed config, an `unknown`/`any` payload out of your control — apply object shape validation and ESTIMATE/CONFIRM the type(s) at runtime before relying on the object's fields.

THE RULE:
- VALIDATE THE SHAPE: confirm the object has the expected fields, field types, and nesting (a type guard, schema validator, or structural check) before reading those fields — feed this through the reused validation layer where one exists (see api-input-validation).
- ESTIMATE/CONFIRM RUNTIME TYPES: for live/untyped data, confirm the actual runtime type (typeof/instanceof/type guard; see wiring-sync-and-consolidation: typeof/satisfies for live data structures) rather than assuming the static type. This is the correct way to avoid `any`-escape-hatch handling (see strict-types-and-reuse: avoid untyped payload handling).
- AVOID THE SHALLOW TRAP: shape validation is not merely "the property exists" — the value may be present but the wrong type or shape (a string where a number is expected, a nested object where an array belongs). Detect and handle that (see boundary-value-handling for the value-variety handling).
- An unchecked untyped field is a crash (`undefined`-property access) or a silent-wrong-value source.

WHY: an untyped object is a contract you have not verified; trusting its shape is the same class of bug as trusting an unsourced claim (see verify-api-actuality). Confirming the shape at the boundary is cheap and removes the crash/wrong-value class.

TIES: api-input-validation, strict-types-and-reuse, wiring-sync-and-consolidation, boundary-value-handling, verify-api-actuality, prefer-repo-json-buffer-wrappers.

DON'T OVER-APPLY: for typed, trusted data (type-checked at compile time, no external boundary), runtime re-validation is redundant — apply shape validation where data crosses an untyped/deserialization boundary, not to every object you touch.
