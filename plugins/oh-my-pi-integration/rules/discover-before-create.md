---
name: discover-before-create
description: "Before creating new functionality, research the repo for something similar already implemented: use repo tooling (symbol search, pattern search, call/dependency graphs) to find existing, unwired, or duplicating functions; prefer reuse, or consolidation into a shared module, over writing a parallel implementation"
condition: ["^(?=[\\s\\S]*new (function|feature|functionality|module|util|helper|api))(?=[\\s\\S]*implement|create (a )?(function|util|helper|module))(?=[\\s\\S]*add[\\s\\S]{0,40}?(function|util|helper))(?=[\\s\\S]*similar[\\s\\S]{0,40}?(exist|implemented)|already (exists|implemented|wired))(?=[\\s\\S]*duplicat(ed|e)? (function|code|implementation)|near-identical)(?=[\\s\\S]*reuse|shared module|DRY|one source of truth)(?=[\\s\\S]*discover|search (the )?(code|repo)|call graph|dependency graph|symbol (search|lookup))"]
scope: ["text", "thinking"]
---

Before creating new functionality, research the repo for something similar already implemented. The repo is the primary source of truth for its own patterns — discovery comes before creation, never after.

USE THE REPO TOOLING TO DISCOVER (this is the job of symbol/pattern/call tools, not eyeballing files):
- SYMBOL SEARCH: same or near-same names and shapes (find_symbol, lsp symbols, code intelligence).
- PATTERN SEARCH: functionality by behavior, not name (semantic/pattern search, ast shapes).
- CALL GRAPH: who calls what — is the candidate wired or orphaned?
- DEPENDENCY GRAPH: is the module imported anywhere, or dead weight?

THREE CLASSES TO FIND, THREE RESPONSES:
1. ALREADY IMPLEMENTED: reuse it — import the existing function/module. Do not write a parallel implementation; a second copy is drift waiting to happen (see wiring-sync-and-consolidation: one definition, imported everywhere).
2. UNWIRED: functionality exists but nothing calls it. Either wire it (if it fits the need) or investigate why it is dead BEFORE writing a parallel — an orphaned implementation may be superseded or incomplete, and duplicating it makes the corpse harder to read.
3. DUPLICATING: multiple near-identical implementations already exist. Do not add a third — propose consolidating them into ONE shared module (single source of truth, one set of tests) and use the consolidated version.

REUSE AND CONSOLIDATION ARE THE DEFAULT, WITH BOUNDARIES:
- Reuse wins when semantics match. If the existing function requires bending callers to fit, a small new function is honest and a forced reuse is worse — name the mismatch and decide deliberately.
- Moving functionality into a shared module is for MULTI-CONSUMER code: propose it (see repo-tooling-scoped-usage: do not silently restructure working code), get the wiring verified, and keep the old call sites migrated in the same change (clean cutover, no shims).
- Respect layer scope: "only X" tasks reuse within the layer, they do not migrate far-side code (see wiring-sync-and-consolidation).

VERIFY the reused path: it must be wired AND covered by tests before you rely on it; an unwired or untested reuse is just a new bug with a familiar name.
