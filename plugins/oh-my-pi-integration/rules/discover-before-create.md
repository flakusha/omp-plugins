---
name: discover-before-create
description: "Before creating new functionality, research the repo for something similar already implemented: use repo tooling (symbol search, pattern search, call/dependency graphs) to find existing, unwired, or duplicating functions; prefer reuse, or consolidation into a shared module, over writing a parallel implementation"
condition: ["^(?=[\\s\\S]*new (function|feature|functionality|module|util|helper|api))(?=[\\s\\S]*implement|create (a )?(function|util|helper|module))(?=[\\s\\S]*add[\\s\\S]{0,40}?(function|util|helper))(?=[\\s\\S]*similar[\\s\\S]{0,40}?(exist|implemented)|already (exists|implemented|wired))(?=[\\s\\S]*duplicat(ed|e)? (function|code|implementation)|near-identical)(?=[\\s\\S]*reuse|shared module|DRY|one source of truth)(?=[\\s\\S]*discover|search (the )?(code|repo)|call graph|dependency graph|symbol (search|lookup))"]
scope: ["text", "thinking"]
---

Before creating new functionality, research the repo for something similar — discovery before creation. Use repo tooling, not eyeballing: symbol search (names/shapes), pattern search (behavior), call graph (wired or orphaned?), dependency graph (dead?).

1. ALREADY IMPLEMENTED: reuse — import it; a second copy is drift waiting to happen (see wiring-sync-and-consolidation).
2. UNWIRED: exists, nothing calls it — wire it (if it fits) or investigate why it's dead BEFORE a parallel (it may be superseded).
3. DUPLICATING: near-identical copies exist — no third; propose consolidating into ONE shared module (single source of truth, one test set).

- If reuse requires bending callers, a small new function is honest — decide deliberately.
- Shared-module extraction is for MULTI-CONSUMER code: propose (see repo-tooling-scoped-usage), verify wiring, migrate call sites in the same change (clean cutover).
- Layer scope: "only X" tasks reuse within the layer (see wiring-sync-and-consolidation).
- VERIFY the reused path: wired AND tested — unwired/untested reuse is a new bug with a familiar name.
