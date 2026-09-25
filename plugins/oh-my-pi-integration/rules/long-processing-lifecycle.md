---
name: long-processing-lifecycle
description: "For long-running processing — identify whether it can be paused, postponed, cached, saved, dropped, cancelled, or offloaded (separate db/table/tmpfs/tmp) and re-picked up by cron/reprocessing/reconciliation — or simply dropped; name the lifecycle decision explicitly"
condition: ["^(?=[\\s\\S]*long-?running|expensive|lengthy|heavy (process|task|job|computation)|takes (long|time)|big batch|slow (task|process))(?=[\\s\\S]*pause|postpone|resume|cache|save|persist|drop|cancel|abort|offload|defer|re-?queue|queue|reprocess|reconcil|checkpoint|porch)(?=[\\s\\S]*cron|scheduler|background (job|task)|separate (db|table|tmpfs|tmp)|re-?pick|pickup|resume (later|later))"]
scope: ["text", "thinking"]
---

Long-running processing: IDENTIFY the lifecycle — pause/postpone/cache/save-checkpoint/drop/cancel; offload (db/table/tmpfs/tmp) with re-pickup (cron/reprocess/reconcile); or simply drop. Name the decision. Consider each; don't default to the hot path.

- OFFLOAD: long deferrable work moves to a queue/separate store, re-picked by cron/scheduler (see async-collector-selection, prefer-async-parallelism; api-schema-versioning: persisted records).
- RESUME vs RESTART: if interruptible, decide which; persisted checkpoint (see api-schema-versioning) makes re-pickup correct; reconciliation covers partial (see deliberate-error-handling).
- DROPPING is legitimate: not every long process must complete — name it (see protocol-timeout-streaming, strict-review-standards).

WHY: undecided long work blocks the hot path, holds resources unboundedly (see protocol-timeout-streaming) — naming the lifecycle makes it reviewable.

TIES: protocol-timeout-streaming, async-collector-selection, prefer-async-parallelism, api-schema-versioning, deliberate-error-handling, strict-review-standards.

DON'T OVER-APPLY: short in-budget processes need no ceremony; targets work that would hold a request/resource indefinitely.
