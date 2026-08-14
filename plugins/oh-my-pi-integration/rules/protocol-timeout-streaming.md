---
name: protocol-timeout-streaming
description: "For protocols that have timeouts and operations that may take significant time — name timeout constraints, stream instead of buffering large/continuous data, handle continuous-communication semantics, and leave a TODO when the current approach should migrate to a different one"
condition: ["timeout|deadline|expiry|long-?running|take(s)? significant time|slow (operation|call|downstream)", "stream|chunk|buffer|backpressure|websocket|\\bsse\\b|long poll|polling|continuous|keep-?alive|socket|event stream", "migrate (to|away)|future (approach|implementation)|different approach|stopgap|interim"]
scope: ["text", "thinking"]
---

For protocols that define timeouts and for operations that may take significant time to complete, name the handling explicitly — timeout, streaming, continuous-communication semantics, and the migration path.

THE RULE — name each:
- TIMEOUT CONSTRAINTS: honor the protocol's timeout on every such operation; a blocked or hung operation must not hold resources indefinitely (see wrap-unsafe-language-apis: no-timeout defaults; see db-access-performance for the DB-specific timeout). Name the timeout and its consequence. Continuous/long-lived calls also get an idle/overall deadline, not just a connect timeout.
- STREAM, DON'T BUFFER: large or continuous data is processed incrementally (chunks, events, backpressure) rather than fully buffered into memory — avoid unbounded reads/buffers (see wrap-unsafe-language-apis: unbounded reads of any stream).
- CONTINUOUS COMMUNICATION: for long-lived exchanges (websocket, SSE, long-poll, keep-alive), confirm reconnect, cancel, timeout, and idle/disconnect semantics are handled — not just the happy stream (see deliberate-error-handling, async-collector-selection).
- TODO FOR FUTURE MIGRATION: if the current approach (blocking call, full buffering, a polling loop, a naive connection) is a stopgap and a streaming/async/proper-protocol approach is the real target, leave a `TODO` naming the migration target and its trigger (see todo-pitfall-comments, forward-compatible-datastructures). A documented stopgap is a decision; an undocumented one is an accident.

WHY: long-running and continuous operations without explicit timeouts, streaming, and migration TODOs hang or exhaust memory silently. Naming the constraint, the streaming strategy, and the shelf-life makes the behavior and its reviewability explicit.

TIES: wrap-unsafe-language-apis, db-access-performance, async-collector-selection, deliberate-error-handling, todo-pitfall-comments, forward-compatible-datastructures.

DON'T OVER-APPLY: a short request covered by a sane library default needs no analysis — the rule targets long-running, large, or continuous operations where buffering and timeout behavior actually matter. And do not build streaming for data that is genuinely small.
