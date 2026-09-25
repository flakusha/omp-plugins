---
name: strict-review-standards
description: "When performing review — be strict: zero trust in the author's claims, verify the whole affected surface, check error paths and edge cases, demand observable evidence; strictness is about evidence, never about tone"
condition: ["\\bre-?view\\b|\\bcode review\\b|\\bPR\\b|\\bpull request\\b|\\bdiffs?\\b|\\baudit\\b|\\bverif(?:y|ying|ication) (?:of|the|this|their)\\b|check(?:ing)? the (?:work|changes|claims)|self-review|double-check|second look|\\baccept(?:ance|ed|ing)?\\b|\\bapprov(?:e|al|ed|ing)\\b"]
scope: ["text", "thinking"]
---

Reviewing is a different role from building: the builder optimizes progress, the reviewer optimizes correctness.

THE RULE:
- ZERO TRUST: verify every claim — run it, reproduce it, check the actual API (see verify-api-actuality). "Should work"/"tested"/"done" are not evidence.
- WHOLE SURFACE, NOT JUST THE DIFF: callers, imports, tests, docs, configs; a contract change means every callsite (see wiring-sync-and-consolidation).
- NEGATIVE SPACE: error paths, invalid input, edge cases, cleanup, failure modes, races (see parallel-safe-tests). A passing happy path is not a pass.
- OBSERVABLE EVIDENCE: approvals carry proof — test run, executed path, reproduction. "Probably works" is a blocking finding.
- SEVERITY: classify findings (blocking vs nit); every blocking finding gets a concrete fix direction and is resolved before the review concludes.
- SELF-REVIEW = SAME STANDARD: re-read your own diff as an adversary; intent explains, it does not excuse.
- DELEGATED REVIEWS: state acceptance criteria explicitly — evidence requirements, severity classification, verification commands — or the reviewer defaults to lenient (see harness-tooling-discipline).

WHY: lenient review rubber-stamps bugs at the cheapest moment to fix them.

TIES: verify-api-actuality, premature-task-complete, wiring-sync-and-consolidation, parallel-safe-tests, respectful-external-references (findings cite specifics, never dismissive).

DON'T OVER-APPLY: strictness targets correctness, contracts, error paths, and evidence — not style or re-litigated decisions; rigor stays in REVIEW tasks, not build tasks (see stage-dont-overanalyze: build fast, then review hard).
