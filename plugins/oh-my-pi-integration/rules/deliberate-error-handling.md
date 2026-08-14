---
name: deliberate-error-handling
description: "For implemented functionality, deliberately choose the error-handling structure — try/catch/finally (or the language's equivalent): what is caught, what propagates, what finally guarantees. Proper error handling is a must, not an afterthought: handle or propagate, never silently swallow"
condition: ["\\btry\\b|\\bcatch\\b|\\bfinally\\b|try/catch|try-catch", "error handling|error path|error-handl", "exception|\\bthrow\\b|\\bpanic\\b|onError", "propagat(e|ion)?|rethrow", "swallow(ed)? (error|exception)", "catch.*ignore|empty catch"]
scope: ["text", "thinking"]
---

For implemented functionality, deliberately choose the error-handling structure. try/catch/finally (or the language's equivalent — `with`/context managers, `defer`, RAII, `Result`/`Option`-style handling) is a design decision, not boilerplate. Proper error handling is a must: every failure path is either HANDLED or PROPAGATED — never silently swallowed.

DELIBERATE THESE, EXPLICITLY:
- PLACEMENT: catch as close to the error as the handling logic lives — the smallest scope that can meaningfully respond. Do not wrap a huge region in `try` when only one call can throw; do not scatter catch for a single concern.
- WHAT IS CAUGHT: catch specific, known, expected error types — only what you can meaningfully handle. Do not blanket-catch programming errors or catch-and-ignore.
- WHAT PROPAGATES: unknown or unexpected errors propagate. Rethrow preserving the cause (`throw`/re-raise, `Err` wrap, `?`), never convert them to a silent success. Blanket `catch {}` that swallows is the bug.
- FINALLY SEMANTICS: `finally` runs regardless of outcome — put resource cleanup there (close, release, restore state, unlock) ONCE, not duplicated on the success and error paths. `finally` is the single place cleanup belongs.
- HANDLE-OR-PROPAGATE, NEVER SWALLOW: handling = recover/fallback/retry with a real path; propagation = the caller owns it. If you swallow, a comment must state WHY and what the fallback is. Silent swallowing is the same disease as silent coercion — a wrong value or missing effect that surfaces far downstream (see no-silent-coercion-parsing).

TIES:
- Error handling is the "wrap + error-handle" half of wrap-unsafe-language-apis: unsafe calls get validation before and explicit error handling after.
- Prefer returning controlled errors over throwing across boundary-crossing code where the repo convention allows (see prefer-repo-json-buffer-wrappers: wrappers return typed/controlled errors).
- ERROR PATHS NEED TESTS: the happy path is not the contract. Test that each expected failure is handled (fallback/retry) or propagated with the cause intact, and that `finally` cleanup runs (see named-tested-regexes: edge cases are the test's job).

DON'T OVER-APPLY: not every function needs try/catch — where failures are not expected or not handleable, let them propagate to a single boundary handler. Over-catch is noise that hides the real contract; under-handle is a crash waiting to ship. Deliberate means choosing, and stating the choice, on each path.
