---
name: no-silent-coercion-parsing
description: "Guard against silent coercion and parsing traps: parseInt without radix, loose ==, implicit Number()/string coercion, Date parsing rollover, default lexicographic sort, float precision, NaN propagation, reduce on empty — validate input before parsing and make conversions explicit so errors surface instead of silently producing wrong values"
condition: ["^(?=[\\s\\S]*parseInt|parseFloat|Number\\(|String\\()(?=[\\s\\S]*loose equal|== (comparison|equality)|\\b==\\b[\\s\\S]{0,40}?(string|number))(?=[\\s\\S]*Date\\.parse|new Date\\([\\s\\S]{0,40}?string)(?=[\\s\\S]*\\.sort\\(\\))(?=[\\s\\S]*0\\.1\\+0\\.2|float (precision|arithmetic)|rounding)(?=[\\s\\S]*NaN|toFixed|toPrecision)(?=[\\s\\S]*\\.reduce\\([\\s\\S]{0,40}?(empty|initial))(?=[\\s\\S]*silent (coercion|conversion|parsing))(?=[\\s\\S]*type coercion)"]
scope: ["text", "thinking"]
---

Guard against silent coercion and parsing traps. Conversions and parses that succeed with a wrong value are worse than ones that throw — the error is invisible until far downstream. Validate before parsing; make conversions explicit; let errors surface.

KNOWN TRAPS (validate-or-explicit before they bite):
- parseInt WITHOUT RADIX: `parseInt("08")`, `parseInt("0x1F")` — base auto-detection changes results; always pass the radix: `parseInt(s, 10)`. `parseFloat` accepts trailing garbage (`"12abc"` → 12).
- LOOSE `==` COERCION: `==` between different types coerces (`0 == ""`, `null == undefined`); prefer strict `===` everywhere unless a deliberate coercion is documented.
- IMPLICIT NUMBER/STRING COERCION: `+x` for numbers, `'' + n`, `[1,2] + ''` — each is a hidden conversion; be explicit (`Number(x)`, template literals — see template-literals-over-concat).
- DATE PARSING ROLLOVER: `new Date("2024-02-30")` silently rolls over instead of failing; parse with an explicit format/validation, never trust string→Date auto-detection.
- DEFAULT `.sort()`: sorts lexicographically — `[10, 9].sort()` → `[10, 9]`. Numeric data needs an explicit comparator; always pass one unless the default is truly intended.
- FLOAT PRECISION: `0.1 + 0.2 !== 0.3`; money and exact comparisons need Decimal/integer-amount representation or epsilon comparisons — never exact float equality.
- NaN PROPAGATION: `NaN` flows silently through arithmetic and comparisons (`NaN !== NaN`); check with `Number.isNaN` and fail fast at the boundary.
- `.reduce()` WITHOUT INITIAL VALUE: throws on an empty array; provide an initial value or handle the empty case explicitly.
- toFixed/rounding: `toFixed` uses float representation (rounding surprises on halves); explicit rounding policy for money (see float precision above).

THE PATTERN: parse with validation (explicit radix/format/locale), check success explicitly (`Number.isNaN`, format-validated dates, comparator correctness), and treat "silently wrong" as a bug — wrap ambiguous conversions so they error or assert instead of coercing. Tests verify the boundary cases (see named-tested-regexes: edge cases are the test's job).

DON'T OVER-APPLY: do not add validation ceremony to trusted, internal, statically-typed paths (the type system already guards them — see strict-types-and-reuse); the traps bite at input boundaries: user input, config, network payloads, and cross-language data.
