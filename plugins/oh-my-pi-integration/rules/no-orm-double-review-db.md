---
name: no-orm-double-review-db
description: "When the project uses no ORM or similar abstraction for DB access — double-review the raw database access commands: parameterization, error handling, transaction boundaries, and every path that builds/sends SQL or commands"
condition: ["^(?=[\\s\\S]*no orm|without (an? )?orm|raw (sql|query|db)|plain (sql|query)|direct (db|database) (access|query|driver))(?=[\\s\\S]*sqlite3|\\bpg\\b|mysql|odbc|jdbc|driver|hand-?written (sql|query))(?=[\\s\\S]*db|database|access (command|query)|no (query builder|abstraction|orm))"]
scope: ["text", "thinking"]
---

NO ORM/abstraction (raw drivers, hand-written SQL) → DOUBLE-REVIEW every DB access command; no framework enforces the checklist, so apply it by hand:
- PARAMETERIZATION: every query with user-derived values parameterized/prepared (see sql-injection-free — stricter without an ORM).
- ERROR HANDLING: commit/rollback and connection close on EVERY branch; never swallow (see deliberate-error-handling).
- TRANSACTION BOUNDARIES: cover the atomic unit; every path, including early return, resolves the transaction.
- POOLING/TIMEOUTS/cursor cleanup: hand-managed — confirm (see db-access-performance).

WHY: an ORM enforces parameterization, escaping, and often transactions by default; without it they are per-path responsibilities easy to skip on an "already reviewed once" path.

TIES: sql-injection-free, deliberate-error-handling, db-access-performance, authorization-confirmed, wrap-unsafe-language-apis.

DON'T OVER-APPLY: not "use an ORM" — raw DB access is legitimate; apply the review the ORM would have enforced instead.
