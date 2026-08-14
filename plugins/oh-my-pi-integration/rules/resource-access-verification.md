---
name: resource-access-verification
description: "Verify access to files and other resources at use time — to avoid incorrect reads, broken filesystem, unavailable resources (applies to external systems and running applications); the happy path is merely a default, not a guarantee"
condition: ["file (read|access|io|open|load)|filesystem|fs\\.|read (from|a|the) file|open (a )?file|read (content|data|from) (a )?file", "resource (unavailable|missing|access|not ?found|doesn'?t exist)|broken|permission|not ?found|econnrefused|refused|timeout|down|offline", "external (system|service|api|request)|running (app|application|process)|happy path|verify (the )?(file|resource|system|availability)"]
scope: ["text", "thinking"]
---

VERIFY access to files and other resources at USE TIME, to avoid incorrect reads, a broken filesystem, or an unavailable resource — and apply the same to requests to external systems and to running applications. The HAPPY PATH is merely a DEFAULT, not a guarantee.

THE RULE:
- VERIFY FILE/RESOURCE ACCESS: confirm the file/resource EXISTS, is READABLE, and is the EXPECTED one BEFORE relying on it. A missing file, a broken filesystem, a permission error, or a resource that vanished is an incorrect-read or crash source — not an assumption to make silently.
- EXTERNAL SYSTEMS / RUNNING APPS: the same verification applies to requests to external systems and to running applications — the resource may be down, unavailable, or mutated (see wrap-unsafe-language-apis: external calls and unbounded reads; see stop-on-external-blockage: an unavailable external system is a blocked condition, not a silent default).
- HAPPY PATH IS MERELY A DEFAULT: treat the successful read/response as the DEFAULT outcome, not the contract — verify access/availability at use time and handle the negative result (see deliberate-error-handling: the happy path is not the contract; error paths need handling and tests; see strict-review-standards: check the negative space).
- INCORRECT READS: verify you are reading the RIGHT resource (path/identity), not just that "a read succeeded" — an incorrect read (wrong file, stale content) is a correctness bug (see verify-api-actuality: verify the actual, not the intended).

WHY: trusting "the file/resource is there" is the same class of bug as trusting an unsourced claim — files break, resources vanish, external systems fail, and the happy path is only a default. Verifying access at use time removes the silent incorrect-read/unavailable crash class.

TIES: deliberate-error-handling, strict-review-standards, wrap-unsafe-language-apis, verify-api-actuality, stop-on-external-blockage, authorization-confirmed (default-deny on the negative path).

DON'T OVER-APPLY: for resources guaranteed-present by construction (compiled-in assets, an already-open handle you own), re-verifying on every use is noise — verify where the resource crosses a real availability boundary (disk, network, external process). Respect the app's own guarantee about owned resources.
