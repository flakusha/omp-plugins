---
name: template-literals-over-concat
description: "Prefer f-strings/template literals (and format methods) over '+' string concatenation — readable, typo-resistant interpolation; for very large or loop-built strings, prefer a static array of parts joined once over one giant template or repeated concatenation"
condition: ["(?=[\\s\\S]*f-string|fstring|template literal)(?=[\\s\\S]*string concat(enation)?|concat(enate)?)(?=[\\s\\S]*\\+[\\s\\S]{0,40}?(string|concat))(?=[\\s\\S]*'[^']*' \\+)(?=[\\s\\S]*\"[^\"]*\" \\+)(?=[\\s\\S]*backtick|`[\\s\\S]{0,80}?\\${)(?=[\\s\\S]*join(\\(|ed))(?=[\\s\\S]*String\\.raw)"]
scope: ["text", "thinking"]
---

Prefer f-strings / template literals (and format methods) over `+` string concatenation. Interpolation reads correctly at the spot where the value goes — no manual separator bookkeeping, no missed spaces, no mixed-quote escapes, natural type coercion.

WHY NOT `+`:
- BUGS: missing spaces, wrong ordering in long chains, quote-escaping mistakes — each fragment is a place for a silent typo.
- UNREADABLE: a long chain of `'a' + b + 'c' + d` is harder to scan than one template with the values inline.
- NOISY: more tokens for the same intent.
- Format methods (`.format()`, printf-style) are equally fine where they fit the project's pattern — the rule is "one coherent interpolation mechanism", not "templates only".

EXCEPTION — HUGE OR LOOP-BUILT STRINGS → ARRAY JOIN:
- For very large strings (generated documents, big payloads, multi-part output) or strings assembled in loops, prefer a static array of parts joined once: `parts.join('')` / `'\n'.join(parts)`.
- WHY: repeated `+=` on a growing string reallocates and copies on every step (quadratic on large inputs); one giant template is unwieldy and hard to review; a parts array is reviewable, conditionally assemblable (push conditionally, join at the end), and allocates once.
- The parts array also keeps huge content greppable and diffable per-part, instead of one monolithic template blob.

DON'T OVER-APPLY:
- Template literals are not a performance fix — the point is readability and correctness. Do not churn existing code purely to convert `+` chains.
- Join the array where the project style calls for it; match the existing convention (see repo-tooling-scoped-usage).
- Measure before optimizing: `+=` in a small fixed-iteration loop is not the quadratic case; joins matter when size or repetition is real.
