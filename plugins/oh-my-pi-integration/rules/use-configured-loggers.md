---
name: use-configured-loggers
description: "Use the logger(s) configured and provided by the application; avoid non-set-up default loggers (bare console.log/print/println, unconfigured root/stdlib loggers) that block, underperform, lack format, and have no handling/dropping/shortening/summarization of incoming data — the configured logger exists precisely for those properties"
condition: ["^(?=[\\s\\S]*console\\.log|console\\.error|console\\.warn|\\bprint\\(|println|\\bprintf\\()(?=[\\s\\S]*default logger|root logger|log\\.Print|log\\.Fatal|stdlib log)(?=[\\s\\S]*configured logger|app(lication)?[\\s\\S]{0,40}?logger|logger[\\s\\S]{0,40}?config(ured|uration))(?=[\\s\\S]*blocking|unbuffered|sync (log|write))(?=[\\s\\S]*truncat|summariz|shorten|sampling|drop[\\s\\S]{0,40}?log|redact|log[\\s\\S]{0,40}?(format|level|sink|handler))"]
scope: ["text", "thinking"]
---

Use the app's configured logger(s) — reach for it first, every time (see log-boundary-events for conventions; see repo-tooling-scoped-usage: existing pattern wins).

AVOID non-set-up defaults (bare `console.log`/`print`/`println`, unconfigured root, unset stdlib `log`) — fallback of last resort: they BLOCK (sync writes stall the hot path), UNDERPERFORM (unbuffered, no batching/sampling), LACK FORMAT (no timestamps/structure/levels/correlation — ungreppable, unparseable; see log-boundary-events), MIS-HANDLE DATA (no redaction — secrets leak; see log-boundary-events: never log secrets; no drop/shorten/summarize). The configured logger handles it: sampling, truncation over budget, summarization (counts/sizes/ids), not raw contents.

HOW:
- Use the app's logger (DI/module/config-provided), its API + levels; never re-implement it.
- No logger where needed (bootstrap, library code): minimal logging, note the gap, no parallel mechanism (see repo-tooling-scoped-usage).
- DEBUG PRINTS: fine as scratch, never the deliverable — convert or remove before landing.

DON'T OVER-APPLY: no busywork logger swaps — NEW/touched lines only (see strict-types-and-reuse); no configured logger at all → a minimal standard one is honest; say so.
