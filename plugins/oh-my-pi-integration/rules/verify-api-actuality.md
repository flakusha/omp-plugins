---
name: verify-api-actuality
description: "Before using an API pattern, verify the current recommended form — await vs .then(), deprecated vs modern functions, current library guidance — instead of pattern-matching on memory; docs tools/MCP, changelogs, and deprecation-aware linters are the source, not training recall"
condition: ["^(?=[\\s\\S]*\\.then\\(|\\.catch\\(|async/await|await vs)(?=[\\s\\S]*deprecat(ed)? (API|method|function)|outdated API)(?=[\\s\\S]*current (recommended|api)|modern (api|replacement))(?=[\\s\\S]*is [\\s\\S]{0,40}? still (current|recommended|used)|actual[\\s\\S]{0,40}?api)(?=[\\s\\S]*verify[\\s\\S]{0,40}?(api|pattern|recommendation)|check[\\s\\S]{0,40}?(api|docs))"]
scope: ["text", "thinking"]
---

Verify the current recommended form before using an API pattern — libraries outpace memory; recall ships outdated patterns.

CHECK, DON'T ASSUME (required before non-trivial API choices):
- DOCS TOOLS / MCP: bun docs, context7, library docs — even for well-known libraries.
- CHANGELOGS/RELEASE NOTES: confirm the function is current, not deprecated.
- LINTERS: deprecation-aware lint/typecheck flags stale usage; never silence without a decision.
- REPO USAGE: if the codebase migrated away, follow it (see repo-tooling-scoped-usage: live patterns beat memory).

KNOWN SHIFTS (verify in context; not exhaustive): `await` is the JS default (readable, try/catch); `.then()` only where await is awkward; parallelism via `Promise.all`/`Promise.allSettled`; `Bun.peek`-style settled reads = advanced perf exception. `new Buffer()` → safe allocation; `fs.exists` → access/stat; `substr` → `slice`; `datetime.utcnow()` → `datetime.now(UTC)`; `io/ioutil` → `io`/`os`; React legacy lifecycle → hooks.

THE PATTERN: state the choice AND its verification source (docs/changelog), never "that's how it's done"; unverifiable → flagged uncertain, not asserted.

DON'T OVER-APPLY: no ceremony for trivially stable built-ins or repo-established code; verify consequential choices (library API, deprecated-looking call, explicit modern alternative) or when unsure.
