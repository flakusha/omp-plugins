---
name: prefer-repo-json-buffer-wrappers
description: "If the repository provides safe wrappers over standard JSON/Buffer functions, use them instead of raw JSON.parse/stringify and Buffer constructors — wrappers validate, type, and guarantee single stringification; raw calls are fine in test code, where a JSON failure is a useful early flag"
condition: ["^(?=[\\s\\S]*JSON\\.(parse|stringify)|JSON\\.)(?=[\\s\\S]*Buffer(\\.from|\\.alloc)?|new Buffer)(?=[\\s\\S]*safe (parse|decode|encode|wrap(per)?))(?=[\\s\\S]*wrapper)(?=[\\s\\S]*stringif(y|ication))(?=[\\s\\S]*double stringif|already (serialized|stringified))(?=[\\s\\S]*json[\\s\\S]{0,40}?wrap|wrap[\\s\\S]{0,40}?json)(?=[\\s\\S]*base64|utf8)"]
scope: ["text", "thinking"]
---

If the repo provides safe JSON/Buffer wrappers, use them over raw `JSON.parse`/`JSON.stringify`/`Buffer` calls.
- VALIDATION + TYPING: raw `JSON.parse` throws a `SyntaxError` mid-flight and returns `any`; a wrapper validates shape, narrows types, returns controlled errors (see strict-types-and-reuse).
- SINGLE STRINGIFICATION: double-stringifying or stringifying already-serialized payloads corrupts consumers; a wrapper keeps one canonical path (one-source-of-truth, see wiring-sync-and-consolidation).
- CENTRALIZED ENCODING: Buffer allocation/encoding policy decided once, not per call site.
PITFALLS RAW CALLS LEAVE OPEN (PortSwigger/OWASP, jsoncraft): prototype pollution (merging parsed objects via recursive merge/`Object.assign`/spread carries `__proto__`/`constructor.prototype` into the chain — wrappers sanitize/reject); duplicate keys (last-wins silently — strict wrappers reject); nesting DoS (deep JSON exhausts stack/cost — wrappers bound depth); JSON injection (hand-concatenated JSON yields invalid/injected payloads — always serialize through the wrapper); stringify throws/loses data (circular refs and BigInt throw; `NaN`/`Infinity` → `null`; `undefined`/functions/symbols dropped silently; `toJSON` injects behavior); Buffer (`new Buffer(...)` deprecated, unsafe allocation; encodings drift per site).
EXCEPTION — TEST CODE: raw calls fine; a raw `JSON.parse` failure is a useful early flag surfacing the broken payload; a swallowing wrapper would mask it.
DON'T OVER-APPLY: only wrappers that EXIST in the repo — never invent a wrapper layer (see repo-tooling-scoped-usage). Raw is fine for one-off trusted literals or where the project convention is raw — match it, flag drift.
