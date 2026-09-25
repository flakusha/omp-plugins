---
name: compact-single-responsibility-functions
description: "Prefer compact functions over big logic chunks: small single-responsibility functions are easy to unit-test by name, combine, and extend; split by responsibility (one reason to change), not by line count, and do not fragment cohesive sequences into indirection noise"
condition: ["^(?=[\\s\\S]*big (function|method|logic|block|chunk))(?=[\\s\\S]*large (function|method|logic))(?=[\\s\\S]*monolithic|god (function|method|class))(?=[\\s\\S]*single responsibility|SRP)(?=[\\s\\S]*refactor[\\s\\S]{0,40}?(function|method|logic))(?=[\\s\\S]*split (the )?(function|method|logic))(?=[\\s\\S]*compact function|small function)(?=[\\s\\S]*unit test[\\s\\S]{0,40}?(function|easy|simple))"]
scope: ["text", "thinking"]
---

Keep functions small enough to name, test, reuse. Split by responsibility (one reason to change), never by line count.

WHY: named units test in isolation (see named-tested-regexes); small pieces compose; new behavior = NEW function, not more branches (api-schema-versioning's additive principle).

- Split where work is plural — each "and then" clause (parse, validate, persist…) is a candidate responsibility.
- Helpers named after what they do; thin orchestration; own test per piece.
- One cohesive job stays whole even if long; a short function doing three jobs still violates.
- No one-line fragmentation of cohesive sequences — indirection noise.
- Performance-critical code: profile first, then split (see strict-types-and-reuse).
- Match project granularity; propose rewrites of working code, never silently (see repo-tooling-scoped-usage).
