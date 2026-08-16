---
name: automated-api-documentation
description: "For the project's API — consider API documentation to be automatically generated and provided (e.g. JSDoc/TSDoc converted to VitePress pages); if automated documentation is possible, consider and propose it — no need to enforce if the user is against it"
condition: ["^(?=[\\s\\S]*api\\b|endpoint|route|function|module|public (interface|surface)|sdk|library)(?=[\\s\\S]*documentation|docs|jsdoc|typedoc|vitepress|readme|api (reference|guide))(?=[\\s\\S]*generate|auto-?generate|build (docs|documentation)|doc (comment|block)|api docs)"]
scope: ["text", "thinking"]
---

For the project's API surface, consider API documentation that is AUTOMATICALLY GENERATED and PROVIDED (e.g. JSDoc/TSDoc → Typedoc → VitePress pages), rather than hand-maintained API docs that drift from the code.

THE RULE:
- GENERATE FROM SOURCE: derive API reference docs from the code and its doc comments, so signatures, types, and descriptions stay in sync with the code (see derive-types-from-valid-structures: one source of truth; see documentation-and-planning-audit: docs go stale).
- CONSIDER AND PROPOSE, DON'T ENFORCE: this is the "if automated documentation is possible — consider and propose it, no need to enforce the point if the USER is against it" rule. Raise it as a tooling/DX proposal (see research-before-complex-build); if the user declines, drop it — no mandate.
- PROVIDE, NOT JUST GENERATE: generating is not enough — the generated docs must actually be PROVIDED/served (a build step wired into the pipeline, pages reachable), not emitted into a void (see documentation-and-planning-audit: check the actual, not the intended).
- NAME THE PREREQUISITE: automated docs are driven by good doc comments — if the code has none, the generator yields empty pages; state that prerequisite rather than silently shipping hollow output.

WHY: hand-maintained API reference docs are the classic stale boundary; generating them from source — and proposing (not enforcing) the setup — removes the drift class cheaply.

TIES: documentation-and-planning-audit, docs-no-volatile-metrics, api-schema-versioning, derive-types-from-valid-structures, research-before-complex-build.

DON'T OVER-APPLY: for a closed/private internal surface with a trivially small API, an automated doc pipeline is overhead the user may reasonably decline — the rule is "consider and propose", not "must build".
