---
name: data-sanitization
description: "Confirm data is sanitized where required — output/context encoding, PII and secret redaction in logs; distinct from validation (reject) vs sanitization (transform to safe form for its destination context)"
condition: ["^(?=[\\s\\S]*sanitiz|sanitize|escape|encode|scrub|redact|clean (input|output|content)|mask)(?=[\\s\\S]*xss|innerHTML|html|shell|attribute|url-encode|log (line|cat|message))(?=[\\s\\S]*user (input|content|data)|untrusted|pii|secret)"]
scope: ["text", "thinking"]
---

Confirm data is sanitized where required: untrusted data becomes safe FOR ITS DESTINATION context — distinct from validation.

- CONTEXT-CORRECT: at the output boundary for the interpretive context — HTML-encode, shell/query/attribute/URL escape; one sanitizer per context (see wrap-unsafe-language-apis).
- DISTINCTION: validation REJECTS (see api-input-validation); sanitization TRANSFORMS accepted-but-untrusted data — never fake one with the other.
- LOGS: PII + secrets redacted pre-log (see use-configured-loggers); scrub fields, not just truncate.
- RIGHT PLACE: at the interpretive boundary — not earlier, not later.
- WHY: the failure is silent — XSS/injection/log-leak; confirm the sanitizer on every required path.
- TIES: api-input-validation, sql-injection-free, wrap-unsafe-language-apis, use-configured-loggers, strict-review-standards.
- DON'T OVER-APPLY: the boundary, not the lifecycle — over-sanitizing trusted data corrupts it.
