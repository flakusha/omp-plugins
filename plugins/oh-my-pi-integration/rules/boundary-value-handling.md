---
name: boundary-value-handling
description: "For values crossing boundaries — handle null/undefined/empty/empty-object/big-number/small-number/error/option/failure/result cases explicitly; tooling may enforce these but is often absent and missed cases can be catastrophic; prefer designed default values to reduce null checks"
condition: ["^(?=[\\s\\S]*\\bnull\\b|undefined|empty (object|string|array|result)|big number|bigint|huge (number|value)|overflow|underflow)(?=[\\s\\S]*error object|failure (object|result)|option (object|value|type)|result (object|type)|\\bmaybe\\b|\\boptional\\b|nullable)(?=[\\s\\S]*return (value|type)|function returns|could be undefined|null pointer|optional chaining|\\b\\?\\.)"]
scope: ["text", "thinking"]
---

Handle boundary-value variety for values crossing function/API edges EXPLICITLY. Project tooling (strict null checks, option/maybe types, pattern matching) may enforce these but is often ABSENT; a missed case can be CATASTROPHIC (undefined-property crash, silent overflow, swallowed failure).

Decide each case explicitly:
- NULL / UNDEFINED / EMPTY: decide null, undefined, empty string/array/object separately — valid, distinguished, or rejected? Be explicit ("empty means X, absent means Y"), never implicitly conflated.
- BIG / SMALL NUMBERS: overflow, BigInt, > `Number.MAX_SAFE_INTEGER`; 0, underflow, precision loss — handled explicitly, never passed as an ordinary "number" (see no-silent-coercion-parsing: NaN; prefer-repo-json-buffer-wrappers: BigInt/NaN JSON).
- ERROR/OPTION/FAILURE/RESULT OBJECTS: distinguish an explicit error/failure/option/result value from a normal result and from absence; a failure must never be silently treated as success or emptiness (see deliberate-error-handling, api-idempotency: response shapes).
- TOOLING: may enforce these — CONFIRM it; if absent, review fills the gap (see strict-review-standards: check the negative space).
- DEFAULTS REDUCE NULL CHECKS: where feasible, design a sensible default (empty array, zero, neutral option) into the field — one defined decision instead of scattered null-guards. Name the default and keep "not set" distinguishable from "set to default".

WHY: boundary values are where programs crash or corrupt — undefined-property access, silent overflow, swallowed failures, option-vs-absence confusion; catastrophic because they sit on the error/failure axis, not the happy path.

TIES: no-silent-coercion-parsing, strict-types-and-reuse, deliberate-error-handling, api-idempotency, object-shape-validation, api-input-validation, strict-review-standards.

DON'T OVER-APPLY: decide the relevant subset for the boundary in question (a structurally-non-null value needs no null branch) — explicit decision, not defensive boilerplate; the narrower correct set over invented cases.
