---
name: documentation-and-planning-audit
description: "When updating/extending docs, plans, tickets — audit implementation-process documents that may always be stale against the actual code; and promote .tmp scratchpad validation scripts that earned their keep into real project hooks"
condition: ["(?=[\\s\\S]*(doc|documentation|README|CHANGELOG|spec|design doc|architecture|plan|epic|ticket|roadmap|backlog))(?=[\\s\\S]*(update|extend|rewrite|add\\b|refer|cite|rely|follow))(?=[\\s\\S]*stale|outdated|out of (date|sync)|drift|drifted|audit|verify against (code|reality))(?=[\\s\\S]*(scratchpad|\\.tmp|\\.scratch)[a-z /]{0,40}script|validation (script|check|gate)|migrate (to|into) (a )?(real )?hook|commit hook|pre-commit)"]
scope: ["text", "thinking"]
---

Documents related to the implementation process — docs, plans, tickets, specs, READMEs, changelogs — describe the code at the moment they were written. Treat them as ALWAYS POTENTIALLY STALE, and audit before relying on them. The audit has a concrete remediation path: promote proven-validation scripts from the scratchpad into real project hooks.

THE RULE (part 1 — audit the always-stale document):
- VERIFY BEFORE TRUSTING OR EXTENDING: check the document against the actual code first (see verify-api-actuality: reality over memory; see wiring-sync-and-consolidation: claim and code must both be current). A stale doc you extend propagates its drift.
- A ticket is a HYPOTHESIS: its scope and acceptance criteria may no longer match implemented reality — re-check before "completing" against it.
- Fix the staleness, or mark the offending section stale, before building on it.
- Mechanics: for reconciling CROSS-AREA references between planning/doc modules and for syncing planning artifacts with the issue tracker, use plan-docs-cross-staleness and plan-sync-after-epic-updates — do NOT re-implement them here.

THE RULE (part 2 — reusable scripts become commit hooks, closing the audit loop):
- Validation scripts that proved useful during development and live in the in-repo ./.tmp scratchpad (see prefer-repo-scratchpad for the scratchpad convention) should MIGRATE to actual project hooks once they earn their keep (see harness-tooling-discipline: re-executable scripts; the plugin lays hooks explicitly).
- A script that worked repeatedly as a manual check — lint/format gate, conflict check, rule/ownership sync, the audit's own verification script — is a candidate to become a real pre-commit/verify hook. Promote it: standardize its home (scripts/), wire it into the gate (verify = lint → typecheck → test → checks), document it, and install it as a hook for the project.
- WHY: the promotion turns a dev-only manual step into a committed, reusable check that protects every future change — and a scratchpad script that only exists to check a docs/process gap is effectively dead if it is not promoted.

WHY THE AUDIT MATTERS: a doc that says one thing while the code does another costs more debugging than the audit ever will. Combined with promotion, the audit is not a one-time correction — the promoted hook makes it repeatable.

TIES: verify-api-actuality, wiring-sync-and-consolidation, plan-docs-cross-staleness, plan-sync-after-epic-updates, prefer-repo-scratchpad, harness-tooling-discipline, docs-no-volatile-metrics, strict-review-standards.

DON'T OVER-APPLY: not every document needs an audit — API/architecture reference that tracks code does; a changelog's historical entries are records, not stale claims. And do NOT promote every scratchpad snippet — only scripts that proved their worth through repeated use get hooked; a one-off debug script does not.
