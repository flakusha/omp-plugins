---
name: verify-api-actuality
description: "Before using an API pattern, verify the current recommended form — await vs .then(), deprecated vs modern functions, current library guidance — instead of pattern-matching on memory; docs tools/MCP, changelogs, and deprecation-aware linters are the source, not training recall"
condition: ["^(?=[\\s\\S]*\\.then\\(|\\.catch\\(|async/await|await vs)(?=[\\s\\S]*deprecat(ed)? (API|method|function)|outdated API)(?=[\\s\\S]*current (recommended|api)|modern (api|replacement))(?=[\\s\\S]*is [\\s\\S]{0,40}? still (current|recommended|used)|actual[\\s\\S]{0,40}?api)(?=[\\s\\S]*verify[\\s\\S]{0,40}?(api|pattern|recommendation)|check[\\s\\S]{0,40}?(api|docs))"]
scope: ["text", "thinking"]
---

Verify the current recommended form before using an API — libraries outpace memory; recall ships stale patterns.

CHECK, DON'T ASSUME (before non-trivial API choice):
- DOCS/MCP: bun docs, context7, library docs — even well-known ones.
- CHANGELOGS: confirm it's current, not deprecated.
- LINTERS: deprecation-aware lint/typecheck flags stale usage; never silence without a decision.
- REPO USAGE: if the repo migrated away, follow it (see repo-tooling-scoped-usage: live patterns beat memory).

KNOWN SHIFTS (verify in context; not exhaustive): await is the JS default (readable, try/catch); .then() only where await is awkward; parallelism via Promise.all/allSettled; Bun.peek-style reads = perf exception. new Buffer() → safe allocation; fs.exists → access/stat; substr → slice; datetime.utcnow() → datetime.now(UTC); io/ioutil → io/os; React legacy lifecycle → hooks.

THE PATTERN: state the choice AND its verification (docs/changelog) — never "that's how it's done"; unverifiable = uncertain, not asserted.

DON'T OVER-APPLY: no ceremony for stable built-ins or repo-established code; verify consequential choices (library API, deprecated-looking call, modern alternative) or unsure.
