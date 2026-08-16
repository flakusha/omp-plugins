---
name: data-sanitization
description: "Confirm data is sanitized where required — output/context encoding, PII and secret redaction in logs; distinct from validation (reject) vs sanitization (transform to safe form for its destination context)"
condition: ["^(?=[\\s\\S]*sanitiz|sanitize|escape|encode|scrub|redact|clean (input|output|content)|mask)(?=[\\s\\S]*xss|innerHTML|html|shell|attribute|url-encode|log (line|cat|message))(?=[\\s\\S]*user (input|content|data)|untrusted|pii|secret)"]
scope: ["text", "thinking"]
---

Confirm data is sanitized where required. Sanitization transforms untrusted or unsafe data into a safe form FOR ITS DESTINATION context — it is distinct from validation.

THE RULE — check each:
- CONTEXT-CORRECT SANITIZATION: sanitize at the output/use boundary for the specific context where unescaped untrusted content would be interpreted — HTML-encode for HTML/XSS (innerHTML), escape for shell/query/attribute/URL contexts. One sanitizer per context; a single global scrub does not cover everything (see wrap-unsafe-language-apis).
- HEALTHY DISTINCTION: validation REJECTS bad input (see api-input-validation); sanitization TRANSFORMS accepted-but-untrusted data into a safe form. Keep both where required; do not use one to fake the other.
- LOGS AND SECRETS: confirm PII and secrets are redacted before logging (see use-configured-loggers: loggers may summarize/drop — but confirm plaintext secrets do not reach logs). Confirm log-structure redaction (scrub fields) not just truncation.
- APPLY AT THE RIGHT PLACE: sanitize where untrusted data crosses an interpretive boundary — not earlier (which corrupts data you may need verbatim) and not later (after the unsafe use).

WHY: unsanitized untrusted data at an interpretive boundary is XSS/injection/log-leak — the failure mode is silent (content is interpreted, not rejected), so correctness requires confirming the sanitizer is present on every required path.

TIES: api-input-validation, sql-injection-free, wrap-unsafe-language-apis, use-configured-loggers, strict-review-standards.

DON'T OVER-APPLY: only sanitize where untrusted data crosses an interpretive boundary. Over-sanitizing trusted internal data corrupts it and is wasted work — sanitize the boundary, not the whole lifecycle.
