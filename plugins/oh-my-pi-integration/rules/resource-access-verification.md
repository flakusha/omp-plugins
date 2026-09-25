---
name: resource-access-verification
description: "Verify access to files and other resources at use time — to avoid incorrect reads, broken filesystem, unavailable resources (applies to external systems and running applications); the happy path is merely a default, not a guarantee"
condition: ["^(?=[\\s\\S]*file (read|access|io|open|load)|filesystem|fs\\.|read (from|a|the) file|open (a )?file|read (content|data|from) (a )?file)(?=[\\s\\S]*resource (unavailable|missing|access|not ?found|doesn'?t exist)|broken|permission|not ?found|econnrefused|refused|timeout|down|offline)(?=[\\s\\S]*external (system|service|api|request)|running (app|application|process)|happy path|verify (the )?(file|resource|system|availability))"]
scope: ["text", "thinking"]
---

VERIFY access to files/resources at USE TIME — same for external systems and running apps. The happy path is a default, not a guarantee.

- VERIFY ACCESS: confirm the resource EXISTS, is READABLE, and is the EXPECTED one before use — missing/vanished resources are crash sources, not silent assumptions.
- EXTERNAL/RUNNING APPS: may be down, unavailable, or mutated (see wrap-unsafe-language-apis; stop-on-external-blockage: unavailable external system = blocked, not silent default).
- HAPPY PATH IS A DEFAULT: verify at use time and handle the negative result (see deliberate-error-handling, strict-review-standards).
- INCORRECT READS: verify the RIGHT resource (path/identity), not just that a read succeeded (see verify-api-actuality).

WHY: trusting "it's there" is the unsourced-claim bug class — verifying at use time removes that crash class.

TIES: deliberate-error-handling, strict-review-standards, wrap-unsafe-language-apis, verify-api-actuality, stop-on-external-blockage, authorization-confirmed.

DON'T OVER-APPLY: resources guaranteed by construction (compiled-in assets, owned open handle) need no re-verification — verify at real availability boundaries (disk, network, external process).
