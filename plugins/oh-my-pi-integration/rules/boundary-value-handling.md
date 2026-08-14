---
name: boundary-value-handling
description: "For values crossing boundaries — handle null/undefined/empty/empty-object/big-number/small-number/error/option/failure/result cases explicitly; tooling may enforce these but is often absent and missed cases can be catastrophic; prefer designed default values to reduce null checks"
condition: ["\\bnull\\b|undefined|empty (object|string|array|result)|big number|bigint|huge (number|value)|overflow|underflow", "error object|failure (object|result)|option (object|value|type)|result (object|type)|\\bmaybe\\b|\\boptional\\b|nullable", "return (value|type)|function returns|could be undefined|null pointer|optional chaining|\\b\\?\\."
]
scope: ["text", "thinking"]
---

Handle the full boundary-value variety for values that cross function, API, or boundary edges — EXplicitly. These cases may be enforced by project tooling (strict null checks, option/maybe types, pattern matching) but are often ABSENT; a missed case can be CATASTROPHIC (undefined-property crash, silent overflow, swallowed failure).

THE RULE — decide each case explicitly:
- NULL / UNDEFINED / EMPTY: decide null, undefined, and empty string/array/object separately — are they valid, distinguished from each other, or rejected? Default to explicit ("empty means X, absent means Y") rather than implicit conflation.
- BIG / SMALL NUMBERS: big values (overflow, BigInt, > `Number.MAX_SAFE_INTEGER`) and small values (0, underflow, precision loss) handled explicitly — do not let them pass as an ordinary "number" (see no-silent-coercion-parsing: silent coercion and NaN; see prefer-repo-json-buffer-wrappers: BigInt/NaN JSON behavior).
- ERROR/OPTION/FAILURE/RESULT OBJECTS: distinguish an explicit error, failure, option, or result value from a normal result and from absence. A `Result`/`Option`/error-object must not be conflated with a plain value, and a failure must not be silently treated as success or as emptiness (see deliberate-error-handling, api-idempotency: response-shape handling).
- TOOLING, IF ABSENT: the variety may be enforced by the project's tooling — but CONFIRM it; if absent, the review fills the gap (see strict-review-standards: check the negative space, not just the happy path).
- DEFAULTS REDUCE NULL CHECKS (related): where feasible, design a sensible default value into the field so readers do not run null/undefined checks everywhere. A well-chosen default (empty array, zero, a neutral option) replaces scattered null-guards with one defined decision. Name the default and confirm it is never confused with a real value ("not set" must be distinguishable from "set to default").

WHY: boundary values are where real programs crash or corrupt — undefined-property access, silent overflow, swallowed failures, and option-vs-absence confusion. These are catastrophic precisely because they sit on the error/failure axis, not the happy path.

TIES: no-silent-coercion-parsing, strict-types-and-reuse, deliberate-error-handling, api-idempotency (response-shape handling), object-shape-validation, api-input-validation, strict-review-standards.

DON'T OVER-APPLY: not every value needs every case handled — decide the relevant subset for the boundary in question (a structurally-non-null value needs no null branch). The rule is explicit decision, not defensive boilerplate everywhere; choose the narrower correct set of cases over invented ones.
