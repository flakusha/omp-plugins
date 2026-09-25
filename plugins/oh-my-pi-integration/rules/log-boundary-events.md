---
name: log-boundary-events
description: "Log incoming and outgoing requests — or at minimum the fact of them happening — at debug/info for external boundaries: connections to other systems/programs, sh/bash and subprocess calls, external allocations/deallocations, tmp access; structured, secret-free, scoped to the boundary class not internal plumbing"
condition: ["^(?=[\\s\\S]*log[\\s\\S]{0,40}?(incoming|outgoing|request|connection)|incoming request|outgoing request)(?=[\\s\\S]*\\bdebug\\b|\\binfo\\b|logging|logger|log level)(?=[\\s\\S]*connection[\\s\\S]{0,40}?(other|external|system|program)|connect[\\s\\S]{0,40}?(db|socket|api))(?=[\\s\\S]*sh/bash|shell call|subprocess|\\bexec\\b|spawn|external (process|call|command))(?=[\\s\\S]*allocat[\\s\\S]{0,40}?(external|deallocat)|resource (acquire|release|allocat)|(socket|file handle|lock)[\\s\\S]{0,40}?(open|close|acquire|release))(?=[\\s\\S]*tmp|temp (file|dir|directory|access))(?=[\\s\\S]*observab|correlation|structured log)"]
scope: ["text", "thinking"]
---

Log in/out requests — at minimum the fact — debug/info at every external boundary: other systems, subprocess/sh calls, external alloc/dealloc (sockets, handles, DB conns, locks), tmp access; unobservable = black box at failure.

- EVENT, not contents: direction, target, outcome, duration, correlation id, resource id (handle/socket/tmp path).
- NEVER LOG SECRETS: credentials, tokens, cookies, keys, sensitive bodies — a logged secret is self-inflicted (see wrap-unsafe-language-apis). Redact or hash; log identifiers, not values.
- LEVELS: DEBUG = routine facts (call, tmp file, handle) — the default; INFO = transitions (connections, significant calls); WARN/ERROR = ACTUAL failures only — warn-everything buries real signals.
- STRUCTURE: project conventions; key=value/JSON where supported, one event/line, consistent fields. Use the project's logger; no parallel mechanism (see repo-tooling-scoped-usage).
- SCOPE: boundary class only, not internal plumbing (see deliberate-error-handling).
- PAIR: log what you handle; the handler logs what propagates (deliberate-error-handling: handle-or-propagate).

THE FACT IS THE FLOOR: minimum: happened/when/what/direction/outcome. Enrich only if safe and useful (debug). In doubt: log the fact.
