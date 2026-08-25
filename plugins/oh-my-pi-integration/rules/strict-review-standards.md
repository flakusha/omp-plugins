---
name: strict-review-standards
description: "When performing review — be strict: zero trust in the author's claims, verify the whole affected surface, check error paths and edge cases, demand observable evidence; strictness is about evidence, never about tone"
condition: ["\\bre-?view\\b|\\bcode review\\b|\\bPR\\b|\\bpull request\\b|\\bdiffs?\\b|\\baudit\\b|\\bverif(?:y|ying|ication) (?:of|the|this|their)\\b|check(?:ing)? the (?:work|changes|claims)|self-review|double-check|second look|\\baccept(?:ance|ed|ing)?\\b|\\bapprov(?:e|al|ed|ing)\\b"]
scope: ["text", "thinking"]
---

When performing review — of your own work, a subagent's output, or someone else's diff — switch to strict mode. Reviewing is a different role from building: the builder optimizes progress, the reviewer optimizes correctness. The standards are intentionally asymmetric.

THE RULE:
- ZERO TRUST: every claim in the work under review gets verified. Do not accept "should work", "tested", or "done" at face value — run it, reproduce it, check the actual API behavior (see verify-api-actuality: verify against the real implementation, not memory or intent).
- REVIEW THE WHOLE SURFACE, NOT JUST THE DIFF: the change touches callers, imports, tests, docs, configs — check them all. A contract change means every callsite (see wiring-sync-and-consolidation: the two-sided check — the change must line up with everything it affects, and everything affected must be updated).
- CHECK THE NEGATIVE SPACE: error paths, invalid input, edge cases, resource cleanup, failure modes, races, parallel-execution hazards (see parallel-safe-tests: shared resources under concurrency). The happy path passing is not a review pass.
- DEMAND OBSERVABLE EVIDENCE: an item approved under review must carry proof — a test run, an executed path, a reproduction. "It probably works" is a blocking finding, not an acceptance.
- NAME SEVERITY: findings are classified — blocking vs nit — and every blocking finding gets a concrete fix direction. Blocking findings are resolved before the review concludes; they are not acknowledged and moved on.
- SELF-REVIEW IS THE SAME STANDARD: re-read your own diff as an adversary, not as the author. The author's intent explains; it does not excuse.
- DELEGATED REVIEWS: when a review goes to a subagent (see harness-tooling-discipline), state the strict acceptance criteria explicitly — evidence requirements, severity classification, and the verification commands — or the reviewer will default to lenient.

WHY: a lenient review rubber-stamps bugs at the cheapest possible moment to fix them, converting them into production incidents paid for later at full cost. Strict review is where the codebase's correctness bar is actually enforced.

TIES: verify-api-actuality, premature-task-complete (the review is the guard against premature "done"), wiring-sync-and-consolidation, parallel-safe-tests, respectful-external-references (strictness is about evidence — never dismissive tone; findings cite specifics).

DON'T OVER-APPLY: strictness does NOT mean blocking on trivia. Nits are nits — the strict standard applies to correctness, contracts, error paths, and evidence, not to style preferences or re-litigating accepted decisions. And review-mode rigor applies to REVIEW tasks; do not carry reviewer paralysis into build tasks (see stage-dont-overanalyze: build fast, then review hard).
