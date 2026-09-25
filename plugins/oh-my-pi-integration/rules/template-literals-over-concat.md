---
name: template-literals-over-concat
description: "Prefer f-strings/template literals (and format methods) over '+' string concatenation — readable, typo-resistant interpolation; for very large or loop-built strings, prefer a static array of parts joined once over one giant template or repeated concatenation"
condition: ["^(?=[\\s\\S]*f-string|fstring|template literal)(?=[\\s\\S]*string concat(enation)?|concat(enate)?)(?=[\\s\\S]*\\+[\\s\\S]{0,40}?(string|concat))(?=[\\s\\S]*'[^']*' \\+)(?=[\\s\\S]*\"[^\"]*\" \\+)(?=[\\s\\S]*backtick|`[\\s\\S]{0,80}?\\${)(?=[\\s\\S]*join(\\(|ed))(?=[\\s\\S]*String\\.raw)"]
scope: ["text", "thinking"]
---

Prefer f-strings/template literals (and format methods) over `+` concatenation: values read where they go — no separator bookkeeping, missed spaces, or quote escapes.

WHY NOT `+`: typo surface (missing spaces, wrong order in chains, escaping mistakes); long `+` chains scan worse than one inline template. Format methods fit where the project uses them — ONE coherent mechanism, not templates-only.

HUGE/LOOP-BUILT STRINGS → ARRAY JOIN: large output or loop assembly uses a static parts array joined once; `+=` on growing strings reallocates per step (quadratic at scale); one giant template is unwieldy; a parts array is reviewable, conditionally assembled, allocates once.

DON'T OVER-APPLY: readability/correctness, not perf — no churn converting `+` chains; join per project style (see repo-tooling-scoped-usage); measure first: small fixed-loop `+=` is not quadratic; joins matter when size/repetition is real.
