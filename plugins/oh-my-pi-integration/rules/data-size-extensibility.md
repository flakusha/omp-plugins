---
name: data-size-extensibility
description: "Optional confirmation — data size/length constraints (enforced, no silent truncation, no unbounded reads) and future extensibility (forward-compatible shapes, schema versioning) where size/extensibility is a real requirement"
condition: ["^(?=[\\s\\S]*size|length|max (size|length)|limit|truncat|buffer|payload|field size|column (size|length))(?=[\\s\\S]*extensib|future (proof|extend|evolution)|reserve|evolve|schema (change|migration|version))(?=[\\s\\S]*\\bapi\\b|db|column|field|payload|data store)"]
scope: ["text", "thinking"]
---

OPTIONALLY confirm size constraints and extensibility where they are a real requirement; skip where speculative.

- SIZE LIMITS ENFORCED: declared limits match reality — no silent truncation of preserved data, no unbounded reads/buffers (see wrap-unsafe-language-apis).
- EXTENSIBILITY: where the structure may evolve — forward-compatible shapes (see forward-compatible-datastructures) + schema versioning (see api-schema-versioning).
- NOT SPECULATIVE: no premature abstraction for schemas that won't change (see multi-env-shared-logic).
- WHY: cheap early, costly to retrofit. Deliverable: the confirmed decision — enforced limit vs none, extensible vs frozen.
- TIES: forward-compatible-datastructures, api-schema-versioning, config-merge-precedence, wrap-unsafe-language-apis, db-access-performance.
- DON'T OVER-APPLY: optional — no limits where none exist, no scaffolding for frozen schemas; a "shape is frozen" note is often the deliverable.
