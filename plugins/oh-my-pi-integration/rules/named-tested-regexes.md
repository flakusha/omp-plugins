---
name: named-tested-regexes
description: "Avoid bare, naked, untested regular expressions inline — declare static regexes as named constants (single source of truth, reusable, testable) and unit-test them for edge cases and performance; dynamic regexes (built at runtime) are exempt from constant form but still need validation and tests"
condition: ["^(?=[\\s\\S]*regexp?|regular expression)(?=[\\s\\S]*pattern match(ing|es)?)(?=[\\s\\S]*new RegExp)(?=[\\s\\S]*\\.match\\(|\\.test\\(|\\.replace\\(|\\.split\\(|\\.exec\\()(?=[\\s\\S]*bare regex|inline regex|naked regex)(?=[\\s\\S]*regex constant|named regex)"]
scope: ["text", "thinking"]
---

A regex is logic — no bare, naked, untested inline regexes. Bare patterns:
- DUPLICATE: re-typed per site, they drift — a magic value (see wiring-sync-and-consolidation).
- SKIP TESTS: anchors, empty/unicode/malformed input, capture groups, catastrophic backtracking fail silently; unnamed = untestable.
- HIDE INTENT: reader reverse-engineers it.
- RECOMPILE/LEAK STATE: `new RegExp` in a body per call; `/g` keeps mutable `lastIndex`.

HOW:
- DECLARE STATIC REGEXES AS NAMED CONSTANTS at module scope (`const EMAIL_RE = /.../`) — compile once, single source of truth.
- UNIT-TEST BY NAME: match/no-match, boundaries, empty input, unicode/escaping, malformed input, capture groups, backtracking.
- REUSED-WITH-OPTIONS: named factory (`makeSlugRe(options)`) with tests.

EXCEPTION — DYNAMIC (`new RegExp(str)` at runtime): cannot be constants; still validate/escape input, test the wrapper, name it if reused — where injection and backtracking bugs live.
