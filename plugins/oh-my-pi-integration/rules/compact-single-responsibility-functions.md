---
name: compact-single-responsibility-functions
description: "Prefer compact functions over big logic chunks: small single-responsibility functions are easy to unit-test by name, combine, and extend; split by responsibility (one reason to change), not by line count, and do not fragment cohesive sequences into indirection noise"
condition: ["(?=[\\s\\S]*big (function|method|logic|block|chunk))(?=[\\s\\S]*large (function|method|logic))(?=[\\s\\S]*monolithic|god (function|method|class))(?=[\\s\\S]*single responsibility|SRP)(?=[\\s\\S]*refactor[\\s\\S]{0,40}?(function|method|logic))(?=[\\s\\S]*split (the )?(function|method|logic))(?=[\\s\\S]*compact function|small function)(?=[\\s\\S]*unit test[\\s\\S]{0,40}?(function|easy|simple))"]
scope: ["text", "thinking"]
---

Prefer compact functions over big logic chunks. A function should be small enough to name, test, and reuse — and carry as much single-responsibility as possible (one reason to change).

WHY COMPACT WINS:
- EASIER TO UNIT-TEST: each compact function is a named unit of behavior, testable in isolation by name — no setup gymnastics, no mocks for everything around it (see named-tested-regexes: testability needs a name).
- EASIER TO COMBINE: small pieces compose — pipeline, map, higher-order wiring. A big chunk can only be called, not composed.
- EASIER TO EXTEND: new behavior lands as a NEW compact function next to its peers, not as more branches inside an existing one (same additive principle as api-schema-versioning: extend, don't mutate).

THE AXIS IS RESPONSIBILITY, NOT LINE COUNT:
- Split where the function does several different kinds of work — parse, validate, transform, persist, notify — each "and then" clause is a candidate responsibility.
- Extract helpers named after what they do; keep the orchestration thin; each extracted piece carries its own name and its own test.
- A function with one cohesive job stays whole even if it is long; a short function doing three jobs is still a violation. Never split purely to shrink line counts.

DON'T OVER-APPLY:
- Do not fragment a genuinely cohesive sequence into one-line functions — that is indirection noise that makes the flow harder to read, not easier.
- In performance-critical code, do not decompose into closure-allocation soup without measuring: profile first, then split what matters (see strict-types-and-reuse: enforcement follows the measured need, not the aesthetic).
- Respect the existing style: match the project's function granularity; a rewrite of working code purely for size churns diffs — propose it, do not silently restructure (see repo-tooling-scoped-usage).
