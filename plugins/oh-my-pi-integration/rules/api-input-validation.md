---
name: api-input-validation
description: "Confirm there is some kind of filter or validation REUSED for API inputs — a shared/central validation layer (schema, DTO, request filter) every entry point consumes, so no path bypasses validation"
condition: ["^(?=[\\s\\S]*\\bapi\\b|endpoint|route|handler|controller)(?=[\\s\\S]*request (body|param|query|header|input)|incoming (data|payload))(?=[\\s\\S]*validate|validat|filter|schema|dto|contract|reject)(?=[\\s\\S]*reuse|shared|central|single (validation|filter|schema)|common (validation|filter))"]
scope: ["text", "thinking"]
---

API inputs require a REUSED validation layer (schema/DTO/filter), not ad-hoc per-handler checks:

- CENTRAL: type, shape, length, format, allowed values checked at the boundary (see config-established-interfaces).
- EVERY ENTRY POINT: no endpoint reachable through a less-validated path; an unwired validator is the bug.
- FAST-FAIL: clear error before any query or side effect (see db-access-performance: fast-fail; sql-injection-free).
- PER-RESOURCE: schema/DTO per resource — no bypass path, not one global function.

WHY: per-handler checks drift — validated on one endpoint, skipped on its twin; reuse keeps one source of truth and closes the bypass class.

TIES: config-established-interfaces, api-schema-versioning, data-sanitization, sql-injection-free, authorization-confirmed.

DON'T OVER-APPLY: "reused" = no bypass path/drift, not one validator for unrelated resources.
