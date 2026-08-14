---
name: data-size-extensibility
description: "Optional confirmation — data size/length constraints (enforced, no silent truncation, no unbounded reads) and future extensibility (forward-compatible shapes, schema versioning) where size/extensibility is a real requirement"
condition: ["size|length|max (size|length)|limit|truncat|buffer|payload|field size|column (size|length)", "extensib|future (proof|extend|evolution)|reserve|evolve|schema (change|migration|version)", "\\bapi\\b|db|column|field|payload|data store"]
scope: ["text", "thinking"]
---

OPTIONALLY confirm data size/length constraints and future extensibility, where they are a real requirement (large payloads, long-lived schemas, external contracts). Apply where needed; skip where speculative.

THE RULE — check each (only as required):
- SIZE/LENGTH CONSTRAINTS ENFORCED: declared limits (column sizes, payload/buffer caps, input length limits) match reality and are enforced — no silent truncation of data that must be preserved, no unbounded reads or buffers (see wrap-unsafe-language-apis: safe defaults include size limits).
- FUTURE EXTENSIBILITY: where the data structure may evolve, use forward-compatible shapes (extras catch-all at external boundaries, see forward-compatible-datastructures) and schema versioning (see api-schema-versioning) so a changed payload does not break old readers.
- EXPLICIT, NOT SPECULATIVE: this item is OPTIONAL BY DESIGN — add size/extensibility handling only where there is a real limit or a real evolution path; avoid premature abstraction for schemas that will not change (see multi-env-shared-logic for the same anti-premature-abstraction stance).

WHY: size limits and schema extensibility are cheap to decide early and costly to retrofit; but equally, scaffolding for hypothetical limits is waste. Confirming the decision — enforced limit vs none, extensible shape vs frozen — is the deliverable.

TIES: forward-compatible-datastructures, api-schema-versioning, config-merge-precedence, wrap-unsafe-language-apis, db-access-performance (payload size vs one-big-request).

DON'T OVER-APPLY: by design, optional. Do not add length constraints where no real limit exists, and do not add extensibility scaffolding for schemas that will not evolve — a one-line note that the shape is frozen is often the whole deliverable.
