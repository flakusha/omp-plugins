---
name: prefer-repo-json-buffer-wrappers
description: "If the repository provides safe wrappers over standard JSON/Buffer functions, use them instead of raw JSON.parse/stringify and Buffer constructors — wrappers validate, type, and guarantee single stringification; raw calls are fine in test code, where a JSON failure is a useful early flag"
condition: ["(?=[\\s\\S]*JSON\\.(parse|stringify)|JSON\\.)(?=[\\s\\S]*Buffer(\\.from|\\.alloc)?|new Buffer)(?=[\\s\\S]*safe (parse|decode|encode|wrap(per)?))(?=[\\s\\S]*wrapper)(?=[\\s\\S]*stringif(y|ication))(?=[\\s\\S]*double stringif|already (serialized|stringified))(?=[\\s\\S]*json[\\s\\S]{0,40}?wrap|wrap[\\s\\S]{0,40}?json)(?=[\\s\\S]*base64|utf8)"]
scope: ["text", "thinking"]
---

If the repository provides safe wrappers over standard JSON/Buffer functions, use them instead of raw `JSON.parse` / `JSON.stringify` / `Buffer` calls.

WHY WRAPPERS:
- VALIDATION + TYPING: raw `JSON.parse` throws a bare `SyntaxError` mid-flight on malformed input and returns `any`; a safe wrapper validates shape, narrows the type, and returns controlled errors or typed results (see strict-types-and-reuse: typed contracts beat untyped payload handling).
- SINGLE STRINGIFICATION: wrappers prevent double/multiple stringification — `JSON.stringify(JSON.stringify(x))` or stringifying an already-serialized payload produces double-encoded strings that corrupt downstream consumers. A wrapper keeps one canonical serialization path (the same one-source-of-truth invariant as wiring-sync-and-consolidation).
- CENTRALIZED ENCODING: Buffer usage (base64/utf8 choices, allocation policy) is decided once in the wrapper instead of re-decided at every call site.

EXCEPTION — TEST CODE: raw JSON.parse/stringify and Buffer are fine in tests, and the rule can be ignored there. In tests a `JSON.parse` failure is a USEFUL EARLY FLAG — it surfaces the exact broken payload immediately; a wrapper that swallows or transforms the error would mask it. Tests want the raw throw.

RESEARCHED PITFALLS RAW CALLS EXPOSE (JSON security pitfalls class — PortSwigger/OWASP, jsoncraft):
- PROTOTYPE POLLUTION: `JSON.parse` itself is safe, but parsed objects merged with recursive merge/`Object.assign`/spread can carry `__proto__` / `constructor.prototype` keys into the prototype chain. Wrappers sanitize or reject such keys; raw parse + merge does not.
- DUPLICATE KEYS: `JSON.parse('{"a":1,"a":2}')` silently last-wins. A strict wrapper can reject duplicates instead of hiding the malformed payload.
- NESTING DoS: deeply nested JSON can exhaust the stack or blow up parsing cost. Wrappers can bound depth; raw parse cannot.
- JSON INJECTION: hand-built JSON via string concatenation (instead of serialization) yields invalid or injected payloads — never construct JSON strings by hand; always serialize through the wrapper.
- STRINGIFY THROWS OR SILENTLY LOSES DATA: circular references and BigInt throw `TypeError`; `NaN`/`Infinity` become `null`; `undefined`/functions/symbols are dropped silently; `toJSON` can inject behavior. Wrappers make these explicit (named errors, replacers) instead of silent.
- BUFFER: `new Buffer(...)` is deprecated (unsafe allocation); raw encoding choices (utf8/latin1/base64) drift per call site. Wrappers centralize allocation and encoding policy.

The wrapper's job is precisely to close these six; raw calls leave them open.

DON'T OVER-APPLY:
- Only use wrappers that EXIST in the repository — do not invent a wrapper layer where none exists (see repo-tooling-scoped-usage: discover the project's patterns first; do not introduce parallel tooling).
- Raw calls are fine for one-off parsing of trusted literals or where the project convention is raw — match it, and flag the drift rather than silently diverging.
