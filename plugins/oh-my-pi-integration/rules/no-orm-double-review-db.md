---
name: no-orm-double-review-db
description: "When the project uses no ORM or similar abstraction for DB access — double-review the raw database access commands: parameterization, error handling, transaction boundaries, and every path that builds/sends SQL or commands"
condition: ["^(?=[\\s\\S]*no orm|without (an? )?orm|raw (sql|query|db)|plain (sql|query)|direct (db|database) (access|query|driver))(?=[\\s\\S]*sqlite3|\\bpg\\b|mysql|odbc|jdbc|driver|hand-?written (sql|query))(?=[\\s\\S]*db|database|access (command|query)|no (query builder|abstraction|orm))"]
scope: ["text", "thinking"]
---

When the project uses NO ORM or similar abstraction for DB access — raw drivers (sqlite3/pg/mysql clients, JDBC/ODBC), hand-written SQL/commands — DOUBLE-REVIEW the database access commands. The abstraction-less path is where parameterization, error handling, and transactions are hand-rolled and most easily drift.

THE RULE — apply the full checklist by hand; the absence of an ORM means NO framework enforces it:
- PARAMETERIZATION/PREPARED: re-verify every query with user-derived values is parameterized/prepared — an ORM enforced this automatically; raw paths make it a per-command responsibility (see sql-injection-free: the rule is stricter, not looser, without an ORM).
- ERROR HANDLING: explicit handling on every failure path — commit/rollback on every branch, connection close even on error, no swallowed exceptions (see deliberate-error-handling: handle-or-propagate, never swallow).
- TRANSACTION BOUNDARIES: confirm transaction start/commit/rollback cover the intended atomic unit and that every path (including error and early-return) resolves the transaction.
- TIME OUT RIGHT: connection pooling, timeouts, and cursor/resource cleanup are hand-managed — confirm them (see db-access-performance).
- So each access command gets the scrutiny a framework would have applied automatically. That is the "double review": compensate for the missing safety net.

WHY: an ORM/abstraction enforces parameterization, escaping, and often transactions by default; without it those are individual responsibilities easy to skip on a path you "already reviewed once".

TIES: sql-injection-free, deliberate-error-handling, db-access-performance, authorization-confirmed, wrap-unsafe-language-apis.

DON'T OVER-APPLY: the rule is not "use an ORM" — raw DB access is legitimate. It is "when there is none, apply the review the ORM would have enforced". Do not add an ORM just to satisfy this rule; add the review.
