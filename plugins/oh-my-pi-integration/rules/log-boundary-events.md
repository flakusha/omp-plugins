---
name: log-boundary-events
description: "Log incoming and outgoing requests — or at minimum the fact of them happening — at debug/info for external boundaries: connections to other systems/programs, sh/bash and subprocess calls, external allocations/deallocations, tmp access; structured, secret-free, scoped to the boundary class not internal plumbing"
condition: ["^(?=[\\s\\S]*log[\\s\\S]{0,40}?(incoming|outgoing|request|connection)|incoming request|outgoing request)(?=[\\s\\S]*\\bdebug\\b|\\binfo\\b|logging|logger|log level)(?=[\\s\\S]*connection[\\s\\S]{0,40}?(other|external|system|program)|connect[\\s\\S]{0,40}?(db|socket|api))(?=[\\s\\S]*sh/bash|shell call|subprocess|\\bexec\\b|spawn|external (process|call|command))(?=[\\s\\S]*allocat[\\s\\S]{0,40}?(external|deallocat)|resource (acquire|release|allocat)|(socket|file handle|lock)[\\s\\S]{0,40}?(open|close|acquire|release))(?=[\\s\\S]*tmp|temp (file|dir|directory|access))(?=[\\s\\S]*observab|correlation|structured log)"]
scope: ["text", "thinking"]
---

Log incoming and outgoing requests — or at minimum the FACT of them happening — at debug/info for every external boundary: connections to other systems/programs, sh/bash and subprocess calls, external allocations and deallocations (sockets, file handles, DB connections, locks), tmp access, and the like. A boundary you cannot observe is a black box the moment it fails.

WHAT TO LOG — the EVENT, not the contents:
- DIRECTION (in/out), TARGET (system, program, resource), OUTCOME (success/failure/status), DURATION, correlation id where available, resource identifiers (which handle/socket/connection/tmp path).
- NEVER LOG SECRETS: credentials, tokens, cookies, keys, or request bodies containing sensitive fields — a logged secret is a security incident you wrote yourself (see wrap-unsafe-language-apis: the boundary discipline is don't-broaden-the-surface; that includes logs). Redact or hash; log identifiers, not values.

LEVELS:
- DEBUG = the routine fact: this call happened, this tmp file was created, this handle allocated — the default for fine-grained boundary events.
- INFO = meaningful transitions: connection established/closed, a significant external call completed, resources acquired/released at scale.
- WARN/ERROR are for ACTUAL failures — normal operation is not an error condition. Do not log every routine call at warn "just in case"; it buries the real signals.

STRUCTURE:
- Follow the project's logging conventions — structured (key=value/JSON) where supported, one event per line, consistent fields across call sites so the logs are greppable and correlatable. Use the project's logger; do not invent a parallel mechanism (see repo-tooling-scoped-usage).

SCOPE DISCIPLINE:
- Log the BOUNDARY class — the enumerated external events — not internal plumbing. Logging every internal call is noise that buries the boundary signals (see deliberate-error-handling: don't over-apply; the family rule is the same).
- LOG WHERE ERRORS ARE HANDLED: pair each boundary log with the error handling — log what you handle at the boundary; let the boundary handler log what propagates (deliberate-error-handling: handle-or-propagate). A decision without a log is unobservable; a log without a decision is noise.

THE FACT IS THE FLOOR: the minimum acceptable is the fact — happened, when, what, direction, outcome. Enrich with arguments/results only where safe (no secrets) and useful (debug level, not info). When in doubt between a bare fact and a payload, log the fact.
