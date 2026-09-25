---
name: strict-types-and-reuse
description: "Prefer strict typing and reuse of the project's types/interfaces/class-derived estimations: typed contracts fail at lint/build/test time instead of runtime — precise, local, cheap to troubleshoot, and safe to modify/extend because the compiler enumerates every affected callsite"
condition: ["^(?=[\\s\\S]*strict( typing| types| mode)?)(?=[\\s\\S]*type safety|type-safe)(?=[\\s\\S]*as any|@ts-ignore|@ts-expect-error|implicit any|loose typing|untyped)(?=[\\s\\S]*reuse (types|interfaces|classes))(?=[\\s\\S]*shared type|common type|one definition)(?=[\\s\\S]*class-derived|derive[\\s\\S]{0,40}?from (the )?(class|interface|schema))(?=[\\s\\S]*typed contract|type contract)"]
scope: ["text", "thinking"]
---

Prefer strict typing + reuse of the project's types/interfaces/class-derived estimations — typed contracts fail at lint/build/test, not runtime.

WHY: type errors name file/symbol/mismatch at the callsite; a shared-type change breaks every affected callsite — wiring-sync-and-consolidation's two-sided invariant, mechanical.

HOW:
- STRICT SETTINGS: TypeScript `strict` (or equiv.), lint rules, test contracts; never weaken/bypass.
- NO ESCAPE HATCHES: `any`/`as any`/`@ts-ignore`/`@ts-expect-error`, avoidable non-null assertions, untyped payloads — documented boundary only, with comment.
- ONE DEFINITION: shared types live once, imported everywhere; no duplicates/mirrors (see wiring-sync-and-consolidation).
- DERIVE, DON'T MIRROR: estimate from live structure (class/interface/schema/data structure), never hand-written.

DON'T OVER-APPLY:
- "Prefer" ≠ "rewrite all": no wholesale conversion of loose code (churns diffs, behavior risk); enforce on NEW/TOUCHED code, legacy gaps stated + proposed.
- Non-strict by choice: match it, flag the risk, don't fight mid-task.
