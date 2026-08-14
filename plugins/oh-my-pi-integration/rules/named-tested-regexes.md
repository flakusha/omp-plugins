---
name: named-tested-regexes
description: "Avoid bare, naked, untested regular expressions inline — declare static regexes as named constants (single source of truth, reusable, testable) and unit-test them for edge cases and performance; dynamic regexes (built at runtime) are exempt from constant form but still need validation and tests"
condition: ["regexp?|regular expression", "pattern match(ing|es)?", "new RegExp", "\\.match\\(|\\.test\\(|\\.replace\\(|\\.split\\(|\\.exec\\(", "bare regex|inline regex|naked regex", "regex constant|named regex"]
scope: ["text", "thinking"]
---

Avoid bare, naked, untested regular expressions inline in code. A regex is logic — treat it with the same discipline as any other non-trivial logic.

PROBLEMS WITH BARE INLINE REGEXES:
- DUPLICATION: the same pattern re-typed at several call sites drifts over time — one site gets fixed, the others silently disagree. This is a magic value; handle it as one (see wiring-sync-and-consolidation).
- UNTESTED: edge cases fail silently — anchors, empty input, unicode, malformed input, capture groups, catastrophic backtracking. A bare pattern has no name, so no test can target it.
- OPAQUE: no name means no intent; the reader must reverse-engineer the pattern.
- SLOW / STATE-STRIPPED: `new RegExp(...)` inside a function body recompiles on every call; `/g` flags keep mutable `lastIndex` state that leaks across calls.

HOW:
- DECLARE STATIC REGEXES AS NAMED CONSTANTS at module scope: `const EMAIL_RE = /.../` — one definition, imported/reused everywhere the pattern applies. Compile once, name the intent, single source of truth.
- UNIT-TEST THEM, by name: match and no-match cases, boundaries (start/end, empty input), unicode and escaping, malformed input, capture groups, and performance (no exponential/catastrophic-backtracking patterns). A named constant is testable; a bare inline pattern is not.
- IF REUSED, WRAP: a pattern used in more than one place is a constant; a pattern used with options is a named factory function (`makeSlugRe(options)`) with its own tests.

EXCEPTION — DYNAMIC REGEXES (built at runtime from input, `new RegExp(str)`):
- Cannot be module constants — but still: validate and escape the input, test the wrapper, and give it a named function if reused. Dynamic patterns are exactly where injection and catastrophic-backtracking bugs live; untested dynamic regexes are the most dangerous kind.
