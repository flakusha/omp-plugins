---
name: multi-env-shared-logic
description: "If the project requires or may require support of multiple execution environments or frameworks (node, bun, deno) — note it in a TODO for future extensions, or use universally shared logic/interfaces with pinpoint runtime resolutions"
condition: ["^(?=[\\s\\S]*node|bun|deno|nodejs|bunjs)(?=[\\s\\S]*runtime|execution environment|platform|framework|portab|multi-env|works in (node|bun|deno))(?=[\\s\\S]*shim|polyfill|adapter|compat|process\\.env|node:fs|Bun\\.file)"]
scope: ["text", "thinking"]
---

When a project touches execution-environment-specific APIs, decide explicitly how multi-environment support is handled — note it, or isolate it.

THE RULE — pick per spot:
- (a) NOTE FOR FUTURE EXTENSIONS: if the code uses an environment-specific API (node:fs vs Bun.file, process.env vs Deno.env, node:test vs bun:test), leave a TODO naming the porting point and trigger: `// TODO(env): bun-only today — add node shim when the node target lands`. The TODO is the commitment that the boundary is known, not accidental.
- (b) UNIVERSALLY SHARED LOGIC + PINPOINT RESOLUTIONS: keep the core logic environment-agnostic (pure shared functions, shared interfaces), and isolate every environment-specific piece behind a thin resolution point — one factory/adapter per runtime, resolved in one place, so "pinpoint logic resolutions" replace scattered `if (runtime === …)` checks.

WHY: environment drift is silent — a project that "works in bun" accumulates node-isms until porting is a rewrite. A named boundary (TODO or adapter) keeps the cost visible and the port a small, mechanical step.

TIES: forward-compatible-datastructures (TODO the expansion points), api-schema-versioning (contracts at boundaries), repo-tooling-scoped-usage (match the project's actual runtime convention — if the project is bun-only and staying bun-only, the TODO note is the right answer, not an adapter).

DON'T OVER-APPLY: do not build adapters for hypothetical second environments. Single-environment projects get the TODO note; the shared-interface split only pays off when a second environment is real or clearly planned. Don't abstract the runtime you don't have.
