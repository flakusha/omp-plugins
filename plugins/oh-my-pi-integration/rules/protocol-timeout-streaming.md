---
name: protocol-timeout-streaming
description: "For protocols that have timeouts and operations that may take significant time — name timeout constraints, stream instead of buffering large/continuous data, handle continuous-communication semantics, and leave a TODO when the current approach should migrate to a different one"
condition: ["^(?=[\\s\\S]*timeout|deadline|expiry|long-?running|take(s)? significant time|slow (operation|call|downstream))(?=[\\s\\S]*stream|chunk|buffer|backpressure|websocket|\\bsse\\b|long poll|polling|continuous|keep-?alive|socket|event stream)(?=[\\s\\S]*migrate (to|away)|future (approach|implementation)|different approach|stopgap|interim)"]
scope: ["text", "thinking"]
---

For protocols with timeouts and long-running operations, name
- TIMEOUT CONSTRAINTS: honor the timeout; a hung operation must not hold resources (see wrap-unsafe-language-apis no-timeout defaults; db-access-performance for DB timeouts); continuous calls get an idle/overall deadline, not just connect.
- STREAM, DON'T BUFFER: large/continuous data processed incrementally — no unbounded reads/buffers (see wrap-unsafe-language-apis).
- CONTINUOUS COMMUNICATION: long-lived exchanges — confirm reconnect, cancel, timeout, idle/disconnect semantics (see deliberate-error-handling, async-collector-selection).
- TODO FOR FUTURE MIGRATION: a stopgap targeting streaming/async/proper-protocol gets a `TODO` naming target/trigger (see todo-pitfall-comments, forward-compatible-datastructures).
WHY: without explicit timeouts, streaming, and migration TODOs, these hang or exhaust memory.
TIES: wrap-unsafe-language-apis, db-access-performance, async-collector-selection, deliberate-error-handling, todo-pitfall-comments, forward-compatible-datastructures.
DON'T OVER-APPLY: short requests under sane library defaults need no analysis — long-running, large, or continuous operations only.
