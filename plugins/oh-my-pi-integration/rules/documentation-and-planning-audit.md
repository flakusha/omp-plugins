---
name: documentation-and-planning-audit
description: "When updating/extending docs, plans, tickets — audit implementation-process documents that may always be stale against the actual code; and promote .tmp scratchpad validation scripts that earned their keep into real project hooks"
condition: ["^(?=[\\s\\S]*(doc|documentation|README|CHANGELOG|spec|design doc|architecture|plan|epic|ticket|roadmap|backlog))(?=[\\s\\S]*(update|extend|rewrite|add\\b|refer|cite|rely|follow))(?=[\\s\\S]*stale|outdated|out of (date|sync)|drift|drifted|audit|verify against (code|reality))(?=[\\s\\S]*(scratchpad|\\.tmp|\\.scratch)[a-z /]{0,40}script|validation (script|check|gate)|migrate (to|into) (a )?(real )?hook|commit hook|pre-commit)"]
scope: ["text", "thinking"]
---

Implementation-process documents (docs, plans, tickets, specs, READMEs) describe the code as it WAS — treat them as ALWAYS POTENTIALLY STALE.

AUDIT:
- Verify against the actual code before trusting or extending (see verify-api-actuality, wiring-sync-and-consolidation); a stale doc you extend propagates its drift.
- A ticket is a HYPOTHESIS: re-check scope/acceptance against implemented reality before "completing" against it.
- Fix staleness — or mark the section stale — before building on it.
- Cross-area doc reconciliation and issue-tracker sync: use plan-docs-cross-staleness / plan-sync-after-epic-updates; do NOT re-implement them here.

PROMOTION (closing the audit loop):
- A ./.tmp scratchpad validation script that earned repeated use (lint/format gate, conflict check, rule/ownership sync) MIGRATES to a real project hook: home it in scripts/, wire it into verify (lint → typecheck → test → checks), document it, install it (see harness-tooling-discipline, prefer-repo-scratchpad).
- WHY: promotion turns a dev-only manual step into a committed check protecting every future change; an unpromoted audit script is dead weight.

TIES: verify-api-actuality, wiring-sync-and-consolidation, plan-docs-cross-staleness, plan-sync-after-epic-updates, prefer-repo-scratchpad, docs-no-volatile-metrics, strict-review-standards.

DON'T OVER-APPLY: changelog history is record, not stale claim; not every doc needs an audit — API/architecture reference that tracks code does. Only repeatedly-useful scripts get hooked; one-off debug scripts don't.
