---
name: long-processing-lifecycle
description: "For long-running processing — identify whether it can be paused, postponed, cached, saved, dropped, cancelled, or offloaded (separate db/table/tmpfs/tmp) and re-picked up by cron/reprocessing/reconciliation — or simply dropped; name the lifecycle decision explicitly"
condition: ["(?=[\\s\\S]*long-?running|expensive|lengthy|heavy (process|task|job|computation)|takes (long|time)|big batch|slow (task|process))(?=[\\s\\S]*pause|postpone|resume|cache|save|persist|drop|cancel|abort|offload|defer|re-?queue|queue|reprocess|reconcil|checkpoint|porch)(?=[\\s\\S]*cron|scheduler|background (job|task)|separate (db|table|tmpfs|tmp)|re-?pick|pickup|resume (later|later))"]
scope: ["text", "thinking"]
---

For long-running processing, actively IDENTIFY the lifecycle: can the long process be PAUSED, POSTPONED, CACHED, SAVED, DROPPED, CANCELLED, or OFFLOADED (into a separate db/table/tmpfs/tmp), and re-picked-up by cron/reprocessing/reconciliation — or SIMPLY DROPPED? Name the decision.

THE RULE:
- THE FULL OPTION SET: pause/resume, postpone/defer, cache the result, save/checkpoint progress, drop/abort, cancel, and offload to a separate store (db, table, tmpfs, tmp). Consider each for the long work at hand — pick the one that fits, don't default to "run it fully in the hot path".
- OFFLOAD + RE-PICKUP: if the work is long and deferrable, consider moving it out of the request/batch path into a queue or separate store, re-picked-up by a cron/scheduler job (see async-collector-selection: long-lived loops and bounded concurrency; see prefer-async-parallelism; see api-schema-versioning: persisted records).
- RESUME vs RESTART: if the process can be interrupted, decide whether it RESUMES from a checkpoint or RESTARTS. A persisted progress/checkpoint record (see api-schema-versioning) is what makes re-pickup correct; reconciliation handles the missed/partial case (see deliberate-error-handling).
- "OR SIMPLY DROPPED": dropping/aborting a disposable long task is a LEGITIMATE outcome — not every long process must complete. Name the drop as a decision (see protocol-timeout-streaming: a documented stopgap is a decision, not an accident; see strict-review-standards: check the negative space).
- WHY IDENTIFY IT: "long-running" without a lifecycle decision defaults to "finish in the hot path", which blocks responses and blows timeouts (see protocol-timeout-streaming).

WHY: long processing left undecided defaults to blocking the hot path and to unbounded resource hold. Explicitly naming pause/postpone/cache/save/drop/cancel/offload-and-repickup turns a hang risk into a reviewable decision.

TIES: protocol-timeout-streaming, async-collector-selection, prefer-async-parallelism, api-schema-versioning, deliberate-error-handling, strict-review-standards.

DON'T OVER-APPLY: short processes that complete well within a budget need no lifecycle ceremony — the rule targets genuinely long/expensive work that, unaddressed, would hold a request or resource indefinitely.
