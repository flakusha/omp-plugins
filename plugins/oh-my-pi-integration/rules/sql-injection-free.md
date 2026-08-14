---
name: sql-injection-free
description: "For DB access implementations — confirm DB injections are not possible: parameterized/prepared statements for all queries with user-derived values, allowlisted dynamic identifiers, and tests on the injection surface"
condition: ["(?=[\\s\\S]*\\bsql\\b|query|select|insert|update|delete|where|join|order by)(?=[\\s\\S]*injection|sql injection|concat(enat)?(e|ion)? sql|string (built|append) (query|sql))(?=[\\s\\S]*db|database|orm|query builder|prepared|parameterized|raw sql)"]
scope: ["text", "thinking"]
---

For DB-access implementations, CONFIRM DB injections are not possible.

THE RULE — check each:
- PARAMETERIZED/PREPARED for ALL queries that incorporate user-derived or dynamic values: never string-concatenate or interpolate user input into SQL. This is the one rule that never bends.
- ORM/QUERY-BUILDER: confirm the framework parameterizes by default and you are not bypassing it; confirm no raw-SQL escape hatches where the framework's parameterization is swapped for string-building.
- DYNAMIC IDENTIFIERS: table/column names, order-by clauses, and batch/array expansion must never come from user input — when dynamic, validate them against an explicit ALLOWLIST (enum/const set), never concatenate (see api-input-validation, named-tested-regexes).
- BLIND SPOTS: LIKE patterns, `IN`-expansion, JSON/ARRAY parameters, and ORDER BY are where injection sneaks past a happy-path check — confirm those paths are parameterized or allowlisted, not concatenated.
- TEST THE SURFACE: errors/negative paths (see strict-review-standards, parallel-safe-tests): a test that feeds malicious input and asserts no injection/error should exist for user-input-touching queries.

WHY: injection is the highest-severity DB vulnerability (data exfiltration, destruction, lateral movement). The parameterize-everything invariant, checked on every dynamic-value path, removes the entire class rather than patching individual holes.

TIES: wrap-unsafe-language-apis (escape the code-execution class; parameterize at the boundary), api-input-validation (validate before querying), data-sanitization, strict-review-standards, named-tested-regexes.

DON'T OVER-APPLY: static/constant SQL fragments with no user-derived values need no parameterization — the rule is about user-derived or dynamic values. And you are not required to eliminate dynamic queries — parameterize them via a safe API or allowlist them.
