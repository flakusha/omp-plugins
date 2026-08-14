---
name: value-sanitation-normalization
description: "Consider sanitation/normalization for incoming values — trim spaces, align case, check and clamp math where required, respect the provided number precision, validate buffer length, and bound loop size/parallelization"
condition: ["sanitiz|normaliz|trim|strip|case (fold|lower|upper)|uppercase|lowercase", "clamp|saturat|\\bmin\\b|\\bmax\\b|precision|rounding|overflow|underflow", "buffer (length|size|validation)|loop (size|count|limit)|large loop|paralleliz|parallel (loop|work)|N items"]
scope: ["text", "thinking"]
---

Consider sanitation/NORMALIZATION for values at their entry/boundary: normalize, clamp, and validate the shape of a value before operations rely on it. (Distinct from data-sanitization, which is output encoding/redaction at an interpretive boundary; and from api-input-validation, which REJECTS invalid input — this is about TRANSFORMING accepted-is-ok values into a canonical form.)

THE RULE:
- NORMALIZE TEXT: trim surrounding spaces; align CASE (upper/lower/case-fold) where a comparison or key uses it — `"foo "`, `"FOO"`, `"foo"` should not silently be three different keys (see derive-types-from-valid-structures: canonical keys/values).
- CHECK AND CLAMP MATH: clamp math values to their valid range (min/max saturation) where out-of-range is not an error but must be bounded; respect the PROVIDED number PRECISION (floats, rounding, >`Number.MAX_SAFE_INTEGER`; see boundary-value-handling: big/small numbers) rather than silently truncating.
- BUFFER LENGTH VALIDATION: validate buffer/array/string LENGTH against what the consumer can handle BEFORE processing (reject or clamp oversized input; see data-size-extensibility; see bounded-paginated-reads for the read-side).
- LOOP SIZE / PARALLELIZATION: bound LOOP SIZE and consider parallelization — a loop over N items is bounded by a sane ceiling, and parallelized or streamed for large N (see prefer-async-parallelism, async-collector-selection: bounded concurrency) instead of an unbounded or blocking loop.
- NAME THE CHOICE: normalization is a TRANSFORM decision — name it ("trimmed, lowercased, clamped to [0,1]") so it is reviewable and never confused with silent corruption.

WHY: unnormalized values cause silent correctness and resource bugs — whitespace/case yield wrong keys, unclamped math yields out-of-range results, unbounded buffers/loops exhaust memory and CPU. Normalizing at the boundary turns implicit surprises into a named transform.

TIES: api-input-validation, data-sanitization, boundary-value-handling, data-size-extensibility, prefer-async-parallelism, async-collector-selection, bounded-paginated-reads, derive-types-from-valid-structures.

DON'T OVER-APPLY: normalization is only warranted where the consumer depends on canonical form — do not trim/case/clamp values whose exact original form is meaningful (passwords, hashes, user-visible formatting, verbatim data). Apply where comparison, keys, range, or precision matter.
