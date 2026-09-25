---
name: automated-api-documentation
description: "For the project's API — consider API documentation to be automatically generated and provided (e.g. JSDoc/TSDoc converted to VitePress pages); if automated documentation is possible, consider and propose it — no need to enforce if the user is against it"
condition: ["^(?=[\\s\\S]*api\\b|endpoint|route|function|module|public (interface|surface)|sdk|library)(?=[\\s\\S]*documentation|docs|jsdoc|typedoc|vitepress|readme|api (reference|guide))(?=[\\s\\S]*generate|auto-?generate|build (docs|documentation)|doc (comment|block)|api docs)"]
scope: ["text", "thinking"]
---

For the project's API surface, consider documentation AUTOMATICALLY GENERATED and PROVIDED (e.g. JSDoc/TSDoc → Typedoc → VitePress pages) instead of hand-maintained docs that drift:

- GENERATE FROM SOURCE: derive docs from code and doc comments so signatures, types, descriptions stay in sync (see derive-types-from-valid-structures: one source of truth; documentation-and-planning-audit: docs go stale).
- CONSIDER AND PROPOSE, DON'T ENFORCE: raise it as a tooling/DX proposal; if the user declines, drop it — no mandate.
- PROVIDE, NOT JUST GENERATE: docs must actually be served (build step wired into the pipeline, pages reachable), not emitted into a void (see documentation-and-planning-audit: check the actual).
- NAME THE PREREQUISITE: generated docs are driven by good doc comments — if the code has none, the generator yields empty pages; state that rather than shipping hollow output.

WHY: hand-maintained API reference is the classic stale boundary; generating from source removes the drift class cheaply.

TIES: documentation-and-planning-audit, docs-no-volatile-metrics, api-schema-versioning, derive-types-from-valid-structures, research-before-complex-build.

DON'T OVER-APPLY: for a closed/private internal surface with a trivially small API, the pipeline is overhead the user may reasonably decline — "consider and propose", not "must build".
