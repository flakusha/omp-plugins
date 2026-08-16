---
name: api-input-validation
description: "Confirm there is some kind of filter or validation REUSED for API inputs — a shared/central validation layer (schema, DTO, request filter) every entry point consumes, so no path bypasses validation"
condition: ["^(?=[\\s\\S]*\\bapi\\b|endpoint|route|handler|controller)(?=[\\s\\S]*request (body|param|query|header|input)|incoming (data|payload))(?=[\\s\\S]*validate|validat|filter|schema|dto|contract|reject)(?=[\\s\\S]*reuse|shared|central|single (validation|filter|schema)|common (validation|filter))"]
scope: ["text", "thinking"]
---

Confirm there is some kind of filter or validation REUSED for API inputs — a shared validation layer, not ad-hoc per-handler checks that drift and get skipped.

THE RULE — check each:
- SHARED/CENTRAL VALIDATION: a schema validator, DTO, or request filter that related endpoints consume — type, shape, length, format, and allowed values checked at the boundary (see config-established-interfaces: reuse established interface/contract types).
- REUSED AT EVERY ENTRY POINT: the same rules apply to the public API and to internal callers — one endpoint must not be reachable through a less-validated path. A validators that exists but is not wired everywhere is the bug.
- FAST-FAIL: reject invalid input quickly with a clear error (see db-access-performance: fast-fail path), before any query or side effect (see sql-injection-free).
- PER-RESOURCE, NOT "ONE MONOLITH": related endpoints share a schema/DTO per resource; the point is no ad-hoc bypass path, not one global function for everything.

WHY: validation scattered per-handler is duplicated truth that drifts — validated on one endpoint, skipped on the twin that shares its logic. A reused layer keeps one source of truth and closes the bypass class.

TIES: config-established-interfaces (reuse established types), api-schema-versioning (the contract), data-sanitization, sql-injection-free, authorization-confirmed.

DON'T OVER-APPLY: "reused" means no bypass path and no duplicated drift — it does not force one validator for unrelated resources. Match the project's API structure; a schema/DTO per resource with shared helpers is enough.
