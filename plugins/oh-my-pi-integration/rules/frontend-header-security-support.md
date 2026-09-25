---
name: frontend-header-security-support
description: "For the frontend — review and confirm security and support for HTTP headers: incorrect initialization, lack of headers, or misconfiguration can make the entire page dysfunctional; the depth is environment/frontend-implementation dependent and MAY be postponed for a primitive MVP/POC"
condition: ["^(?=[\\s\\S]*frontend|client|browser|page|app|spa)(?=[\\s\\S]*header|\\bmeta\\b|http (head)|request header|response header|security header)(?=[\\s\\S]*content-security|csp|x-frame|frame-ancestors|iframe|cors|referrer|hsts|csrf|authorization|token)"]
scope: ["text", "thinking"]
---

Confirm BOTH security and support for frontend headers — a wrong/missing/mis-initialized header breaks the ENTIRE PAGE. The required set is environment/implementation-dependent: NAME which apply HERE.

- SECURITY HEADERS: confirm CSP, X-Frame-Options/frame-ancestors, Referrer-Policy, HSTS, CORS are present AND correct — a wrong/missing one is a security hole (see avoid-inline-style-script, data-sanitization, authorization-confirmed).
- SUPPORT HEADERS: confirm required headers are initialized and passed — auth tokens, app headers, contentType, origin/referrer, meta equivalents. INCORRECT INITIALIZATION breaks requests or rendering.
- MVP/POC: HARDENING MAY be postponed — as an explicit, stated decision (see frontend-backend-validation), never silent. Functional-break fixes are NEVER postponed.

WHY: a missing CSP or misconfigured auth header is both a security hole and an opaque whole-page break.

TIES: authorization-confirmed, wrap-unsafe-language-apis, data-sanitization, avoid-inline-style-script, frontend-backend-validation, api-schema-versioning, strict-review-standards.

DON'T OVER-APPLY: only the required subset; respect MVP/POC postponement on throwaway prototypes.
