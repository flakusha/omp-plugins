---
name: sql-injection-free
description: "For DB access implementations — confirm DB injections are not possible: parameterized/prepared statements for all queries with user-derived values, allowlisted dynamic identifiers, and tests on the injection surface"
condition: ["^(?=[\\s\\S]*\\bsql\\b|query|select|insert|update|delete|where|join|order by)(?=[\\s\\S]*injection|sql injection|concat(enat)?(e|ion)? sql|string (built|append) (query|sql))(?=[\\s\\S]*db|database|orm|query builder|prepared|parameterized|raw sql)"]
scope: ["text", "thinking"]
---

CONFIRM DB injections are not possible.

- PARAMETERIZED/PREPARED for ALL queries with user-derived or dynamic values — never interpolate user input into SQL.
- ORM/QUERY-BUILDER: confirm default parameterization; no raw-SQL string-building bypass.
- DYNAMIC IDENTIFIERS: table/column names, order-by, batch expansion never from user input — ALLOWLIST when dynamic, never concatenate (see api-input-validation, named-tested-regexes).
- BLIND SPOTS: LIKE, `IN`-expansion, JSON/ARRAY params, ORDER BY — parameterized or allowlisted, never concatenated.
- TEST THE SURFACE (see strict-review-standards, parallel-safe-tests): user-input-touching queries need an injection test.

WHY: parameterize-everything removes the entire injection class — the highest-severity DB vulnerability.

TIES: wrap-unsafe-language-apis, api-input-validation, data-sanitization, strict-review-standards, named-tested-regexes.

DON'T OVER-APPLY: static/constant SQL needs no parameterization; dynamic queries stay allowed if parameterized/allowlisted.
