---
name: strict-types-and-reuse
description: "Prefer strict typing and reuse of the project's types/interfaces/class-derived estimations: typed contracts fail at lint/build/test time instead of runtime — precise, local, cheap to troubleshoot, and safe to modify/extend because the compiler enumerates every affected callsite"
condition: ["^(?=[\\s\\S]*strict( typing| types| mode)?)(?=[\\s\\S]*type safety|type-safe)(?=[\\s\\S]*as any|@ts-ignore|@ts-expect-error|implicit any|loose typing|untyped)(?=[\\s\\S]*reuse (types|interfaces|classes))(?=[\\s\\S]*shared type|common type|one definition)(?=[\\s\\S]*class-derived|derive[\\s\\S]{0,40}?from (the )?(class|interface|schema))(?=[\\s\\S]*typed contract|type contract)"]
scope: ["text", "thinking"]
---

Prefer strict typing and reuse of the project's types, interfaces, and class-derived estimations. Strictness is a shift-left strategy: typed contracts fail at the earliest cheap stage — lint, build, test — instead of at runtime, where errors are harder to trace and cost more.

WHY (the payoff):
- EASIER TO TROUBLESHOOT: a type error names the exact file, symbol, and mismatch at the callsite. A runtime error only tells you where it blew up, not which contract it violated.
- EASIER TO MODIFY/EXTEND: the compiler/linter/test suite breaks on EVERY affected callsite when a shared type changes — the same "two-sided invariant" as wiring-sync-and-consolidation, but enforced mechanically. You never miss a caller by hand.

HOW:
- RESPECT THE PROJECT'S STRICT SETTINGS: TypeScript `strict` (or the language's equivalent), lint rules, and test contracts are the enforcement layer. Do not weaken or bypass them for convenience.
- AVOID ESCAPE HATCHES: `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, avoidable non-null assertions, and untyped payload handling — unless a documented boundary genuinely requires them, and then only at that boundary, with a comment.
- REUSE ONE DEFINITION: shared types/interfaces/class-derived types live in one place and are imported everywhere they appear. No duplicate definitions, no hand-written mirrors (see wiring-sync-and-consolidation).
- DERIVE FROM LIVE STRUCTURE: when a type must be estimated, derive it from the live source of truth — the class, interface, schema, or actual data structure the project already defines — never from a parallel hand-written shape.

DON'T OVER-APPLY:
- "Prefer" is not "rewrite everything now". Do not silently convert an existing loose codebase wholesale — that churns diffs and risks behavior changes.
- Enforce strictness on NEW code and on TOUCHED code; for legacy loose areas, state the gap and propose the migration rather than doing it unrequested.
- Follow the project's settings: if the project deliberately runs non-strict, match it and flag the risk instead of fighting it mid-task.
