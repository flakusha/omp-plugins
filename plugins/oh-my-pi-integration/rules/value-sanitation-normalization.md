---
name: value-sanitation-normalization
description: "Consider sanitation/normalization for incoming values — trim spaces, align case, check and clamp math where required, respect the provided number precision, validate buffer length, and bound loop size/parallelization"
condition: ["^(?=[\\s\\S]*sanitiz|normaliz|trim|strip|case (fold|lower|upper)|uppercase|lowercase)(?=[\\s\\S]*clamp|saturat|\\bmin\\b|\\bmax\\b|precision|rounding|overflow|underflow)(?=[\\s\\S]*buffer (length|size|validation)|loop (size|count|limit)|large loop|paralleliz|parallel (loop|work)|N items)"]
scope: ["text", "thinking"]
---

NORMALIZE values at entry, before relying on them — not data-sanitization (output encoding) nor api-input-validation (rejects invalid): this TRANSFORMS accepted values to canonical form.

- NORMALIZE TEXT: trim + case-align for comparisons/keys (three spellings ≠ three keys; see derive-types-from-valid-structures).
- CLAMP MATH: clamp to range (min/max saturation), bounded not error; respect PROVIDED PRECISION (rounding, >MAX_SAFE_INTEGER; see boundary-value-handling); no silent truncation.
- BUFFER LENGTH: validate length vs consumer capacity BEFORE processing; reject/clamp oversize (see data-size-extensibility; bounded-paginated-reads).
- LOOPS: bound loop count; large N: parallelize/stream, bounded concurrency (see prefer-async-parallelism, async-collector-selection); never unbounded.

WHY: unnormalized values break silently (wrong keys, bad math, exhausted memory/CPU); NAME it — reviewable, not silent corruption.

TIES: api-input-validation, data-sanitization, boundary-value-handling, data-size-extensibility, prefer-async-parallelism, async-collector-selection, bounded-paginated-reads, derive-types-from-valid-structures.

DON'T OVER-APPLY: only where canonical form matters — never trim/case/clamp exact-form values (passwords, hashes, user-visible formatting, verbatim); apply where comparison/keys/range/precision matter.
