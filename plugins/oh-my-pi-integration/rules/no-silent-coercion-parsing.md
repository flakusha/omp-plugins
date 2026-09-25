---
name: no-silent-coercion-parsing
description: "Guard against silent coercion and parsing traps: parseInt without radix, loose ==, implicit Number()/string coercion, Date parsing rollover, default lexicographic sort, float precision, NaN propagation, reduce on empty — validate input before parsing and make conversions explicit so errors surface instead of silently producing wrong values"
condition: ["^(?=[\\s\\S]*parseInt|parseFloat|Number\\(|String\\()(?=[\\s\\S]*loose equal|== (comparison|equality)|\\b==\\b[\\s\\S]{0,40}?(string|number))(?=[\\s\\S]*Date\\.parse|new Date\\([\\s\\S]{0,40}?string)(?=[\\s\\S]*\\.sort\\(\\))(?=[\\s\\S]*0\\.1\\+0\\.2|float (precision|arithmetic)|rounding)(?=[\\s\\S]*NaN|toFixed|toPrecision)(?=[\\s\\S]*\\.reduce\\([\\s\\S]{0,40}?(empty|initial))(?=[\\s\\S]*silent (coercion|conversion|parsing))(?=[\\s\\S]*type coercion)"]
scope: ["text", "thinking"]
---

A parse that succeeds wrong is worse than one that throws — errors surface far downstream. Validate first; be explicit; surface errors.
TRAPS (validate-or-explicit first):
- parseInt: always pass radix — `parseInt(s, 10)`; `parseFloat` accepts trailing garbage.
- LOOSE `==`: coerces — `===` unless deliberate/documented.
- IMPLICIT COERCION: `+x`, `'' + n` — explicit `Number(x)` (see template-literals-over-concat).
- DATE ROLLOVER: `new Date("2024-02-30")` rolls over silently — explicit format/validation.
- DEFAULT `.sort()`: lexicographic (`[10, 9]` stays) — pass a comparator.
- FLOAT PRECISION: `0.1 + 0.2 !== 0.3` — Decimal/integer amounts or epsilon.
- NaN: flows silently — `Number.isNaN`, fail fast.
- `.reduce()` NO INITIAL VALUE: throws on empty — pass one.
- toFixed: float rounding surprises — explicit policy for money.
PATTERN: explicit radix/format/locale; explicit success checks (`Number.isNaN`, validated dates, comparators); "silently wrong" = bug — wrap ambiguous conversions to error/assert. Tests verify boundaries (see named-tested-regexes).
DON'T OVER-APPLY: no ceremony on trusted statically-typed paths (see strict-types-and-reuse); traps bite at input boundaries — user input, config, network payloads, cross-language data.
