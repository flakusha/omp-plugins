---
name: deliberate-error-handling
description: "For implemented functionality, deliberately choose the error-handling structure — try/catch/finally (or the language's equivalent): what is caught, what propagates, what finally guarantees. Proper error handling is a must, not an afterthought: handle or propagate, never silently swallow"
condition: ["^(?=[\\s\\S]*\\btry\\b|\\bcatch\\b|\\bfinally\\b|try/catch|try-catch)(?=[\\s\\S]*error handling|error path|error-handl)(?=[\\s\\S]*exception|\\bthrow\\b|\\bpanic\\b|onError)(?=[\\s\\S]*propagat(e|ion)?|rethrow)(?=[\\s\\S]*swallow(ed)? (error|exception))(?=[\\s\\S]*catch[\\s\\S]{0,40}?ignore|empty catch)"]
scope: ["text", "thinking"]
---

Deliberately choose the error-handling structure — try/catch/finally (or `with`/defer/RAII/`Result`-style): every failure path is HANDLED or PROPAGATED, never silently swallowed.

- PLACEMENT: smallest scope that can meaningfully respond — no huge wrapped regions, no scattered catches for one concern.
- CAUGHT: specific, known, expected types only — no blanket-catching programming errors, no catch-and-ignore.
- PROPAGATED: unknown/unexpected errors rethrow preserving cause (`throw`/`Err` wrap/`?`) — never silent success; blanket swallowing `catch {}` is the bug.
- FINALLY: cleanup (close, release, restore, unlock) ONCE — not duplicated per path.
- HANDLE-OR-PROPAGATE: handling = recover/fallback/retry with a real path; propagation = caller owns it. Swallowing requires a comment stating WHY + fallback (see no-silent-coercion-parsing).
- TIES: wrap-unsafe-language-apis (validation before, error handling after unsafe calls); prefer-repo-json-buffer-wrappers (controlled errors across boundaries).
- ERROR PATHS NEED TESTS: each expected failure handled or propagated with cause intact; `finally` cleanup runs (see named-tested-regexes).
- DON'T OVER-APPLY: not every function needs try/catch — unexpected failures propagate to a single boundary handler. Over-catch hides the contract; under-handle is a crash. Deliberate = choosing per path.
