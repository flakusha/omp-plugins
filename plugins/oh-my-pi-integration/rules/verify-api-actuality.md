---
name: verify-api-actuality
description: "Before using an API pattern, verify the current recommended form — await vs .then(), deprecated vs modern functions, current library guidance — instead of pattern-matching on memory; docs tools/MCP, changelogs, and deprecation-aware linters are the source, not training recall"
condition: ["(?=[\\s\\S]*\\.then\\(|\\.catch\\(|async/await|await vs)(?=[\\s\\S]*deprecat(ed)? (API|method|function)|outdated API)(?=[\\s\\S]*current (recommended|api)|modern (api|replacement))(?=[\\s\\S]*is .* still (current|recommended|used)|actual.*api)(?=[\\s\\S]*verify.*(api|pattern|recommendation)|check.*(api|docs))"]
scope: ["text", "thinking"]
---

Before using an API pattern, verify the current recommended form. Libraries change faster than memory: the API you "know" may be deprecated, superseded, or non-idiomatic now. Pattern-matching on training recall is how outdated patterns ship.

CHECK, DO NOT ASSUME (the investigation is required before a non-trivial API choice):
- DOCS TOOLS / MCP: the harness's docs lookups (bun docs, context7, library docs) are the current source — use them for libraries you use, even well-known ones.
- CHANGELOGS / RELEASE NOTES: confirm the function you reach for is current and not marked deprecated.
- DEPRECATION-AWARE LINTERS: rely on the project's lint/typecheck to flag deprecated usage; do not silence such warnings without a decision.
- THE REPO'S OWN CURRENT USAGE: if the codebase already migrated away from a pattern, follow it (see repo-tooling-scoped-usage: the repo's live patterns beat convention from memory).

EXAMPLES (known actuality shifts — verify each in context, don't take this list as exhaustive):
- JS async: `await` is the recommended default (readable, try/catch, no callback nesting). `.then()`/`.catch()` are optional where await is awkward — conditional composition, a chain you must not hold in scope — and parallelism is `Promise.all`/`Promise.allSettled`, not `.then` chains. Settled-promise reads without await (`Bun.peek` and equivalents) are the advanced perf exception, not the default.
- Deprecated/moved: `new Buffer()` → safe allocation; `fs.exists` → access/stat; `String.prototype.substr` → `slice`; Python `datetime.utcnow()` → `datetime.now(UTC)`; Go `io/ioutil` → `io`/`os`; React legacy lifecycle → current hooks/lifecycle.

THE PATTERN: for any API choice with a documented recommended form, state the choice AND that you verified it against current docs — not "I used X because that's how it's done" but "X is the current recommended form (docs/changelog source)." Unverifiable actuality gets flagged as uncertain, not asserted.

DON'T OVER-APPLY: do not block on verification for trivially stable built-ins or code the repo already established; verify when the pattern is consequential (a library API, a deprecated-looking call, a style choice with an explicit modern alternative) or when you are unsure.
