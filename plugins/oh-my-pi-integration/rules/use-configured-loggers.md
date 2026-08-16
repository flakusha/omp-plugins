---
name: use-configured-loggers
description: "Use the logger(s) configured and provided by the application; avoid non-set-up default loggers (bare console.log/print/println, unconfigured root/stdlib loggers) that block, underperform, lack format, and have no handling/dropping/shortening/summarization of incoming data — the configured logger exists precisely for those properties"
condition: ["^(?=[\\s\\S]*console\\.log|console\\.error|console\\.warn|\\bprint\\(|println|\\bprintf\\()(?=[\\s\\S]*default logger|root logger|log\\.Print|log\\.Fatal|stdlib log)(?=[\\s\\S]*configured logger|app(lication)?[\\s\\S]{0,40}?logger|logger[\\s\\S]{0,40}?config(ured|uration))(?=[\\s\\S]*blocking|unbuffered|sync (log|write))(?=[\\s\\S]*truncat|summariz|shorten|sampling|drop[\\s\\S]{0,40}?log|redact|log[\\s\\S]{0,40}?(format|level|sink|handler))"]
scope: ["text", "thinking"]
---

Use the logger(s) configured and provided by the application. The app's logger exists precisely for the properties a bare default lacks — reach for it first, every time (see log-boundary-events: follow the project's logging conventions; see repo-tooling-scoped-usage: the existing pattern wins).

AVOID NON-SET-UP DEFAULT LOGGERS: bare `console.log`/`print`/`println`, the unconfigured root logger, the stdlib `log` package with no setup. They are a fallback of last resort, not the default, because they typically:
- BLOCK: synchronous writes on the hot path stall the caller; the configured logger is async/batched.
- UNDERPERFORM: unbuffered, no batching or sampling, string-concat churn on every call.
- LACK FORMAT: no timestamps, structure, levels, or correlation — ungreppable, unparseable output that the boundary-observability rules (see log-boundary-events) depend on.
- MIS-HANDLE INCOMING DATA: no redaction (secrets leak — see log-boundary-events: never log secrets), no dropping/shortening/summarization — a giant raw payload dumped to the log is memory + noise + a possible secret leak. The configured logger handles exactly that: SAMPLING/dropping under load, TRUNCATION over a size budget, SUMMARIZATION (counts, sizes, ids) instead of full contents.

HOW:
- Find the app's logger — dependency-injected, module-level, config-provided — and use its API and its level discipline. Do not re-implement what it already does.
- If a spot needs logging where no configured logger exists (early bootstrap, library code), keep it minimal and note the gap — do not invent a parallel logger mechanism (see repo-tooling-scoped-usage).
- TEMPORARY DEBUG PRINTS: during active investigation, a quick `console.log`/`print` is an acceptable scratch tool — but it is NOT the deliverable: convert it to the configured logger or remove it before the code lands.

DON'T OVER-APPLY:
- Do not refactor existing logging from one logger to another as busywork — the rule governs NEW code and touched lines (see strict-types-and-reuse: enforce on new/touched code, propose rather than silently rewriting).
- If the application genuinely has no configured logger, a minimal standard one is the honest choice — state that explicitly rather than pretending the bare print is equivalent.
