---
name: multi-env-shared-logic
description: "If the project requires or may require support of multiple execution environments or frameworks (node, bun, deno) — note it in a TODO for future extensions, or use universally shared logic/interfaces with pinpoint runtime resolutions"
condition: ["^(?=[\\s\\S]*node|bun|deno|nodejs|bunjs)(?=[\\s\\S]*runtime|execution environment|platform|framework|portab|multi-env|works in (node|bun|deno))(?=[\\s\\S]*shim|polyfill|adapter|compat|process\\.env|node:fs|Bun\\.file)"]
scope: ["text", "thinking"]
---

Env-specific APIs: decide — note it or isolate it.

- (a) TODO: env-specific API → TODO with porting point + trigger: `// TODO(env): bun-only — add node shim when node target lands`. Boundary known, not accidental.
- (b) SHARED LOGIC + PINPOINT RESOLUTIONS: core env-agnostic (pure functions, shared interfaces); env-specific pieces behind thin resolution points — one adapter per runtime, resolved in one place, not scattered checks.

WHY: drift is silent — bun-only code accumulates node-isms until porting is a rewrite; a named boundary keeps it visible and mechanical.

TIES: forward-compatible-datastructures, api-schema-versioning, repo-tooling-scoped-usage.

DON'T OVER-APPLY: no adapters for hypothetical environments — single-env gets the TODO; split pays off only when a second env is real. Don't abstract a runtime you don't have.
