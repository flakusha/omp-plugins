---
name: frontend-header-security-support
description: "For the frontend — review and confirm security and support for HTTP headers: incorrect initialization, lack of headers, or misconfiguration can make the entire page dysfunctional; the depth is environment/frontend-implementation dependent and MAY be postponed for a primitive MVP/POC"
condition: ["(?=[\\s\\S]*frontend|client|browser|page|app|spa)(?=[\\s\\S]*header|\\bmeta\\b|http (head)|request header|response header|security header)(?=[\\s\\S]*content-security|csp|x-frame|frame-ancestors|iframe|cors|referrer|hsts|csrf|authorization|token)"]
scope: ["text", "thinking"]
---

Review and CONFIRM the security AND support for headers on the frontend. An incorrect initialization, a MISSING header, or a misconfiguration can make the ENTIRE PAGE dysfunctional — not just one feature.

THE RULE:
- SECURITY HEADERS: confirm the relevant security headers are set AND correct for the deployment — CSP, X-Frame-Options/frame-ancestors, Referrer-Policy, HSTS, CORS — because a wrong or missing one is a security hole (see avoid-inline-style-script: CSP and inline scripts; see data-sanitization: XSS; see authorization-confirmed).
- SUPPORT/REQUIRED HEADERS: confirm any headers the app REQUIRES to function are initialized and passed — auth/authorization tokens, custom app headers, contentType, origin/referrer, and any meta equivalents. INCORRECT INITIALIZATION is the failure mode: an absent or malformed required header breaks the page's requests or rendering.
- ENVIRONMENT / IMPLEMENTATION DEPENDENT: the required header set depends on the environment (browser vs native, host, proxy, server) and the frontend implementation (SPA vs server-rendered, meta vs real header). NAME which apply to THIS app rather than assuming a universal set.
- MAY BE POSTPONED FOR MVP/POC: for a primitive MVP/POC, header HARDENING may be postponed — but that is an explicit, stated decision (state it, like the prototype exception in frontend-backend-validation), never a silent absence. Reactive correction of a functional break (a required header missing killing the page) is NEVER postponed.

WHY: headers are a silent, high-leverage surface — a missing CSP or a misconfigured auth header is both a security hole and a whole-page functional break, easy to miss because it manifests opaquely as "the page does not work".

TIES: authorization-confirmed, wrap-unsafe-language-apis, data-sanitization, avoid-inline-style-script, frontend-backend-validation, api-schema-versioning (header negotiation), strict-review-standards (check the negative space).

DON'T OVER-APPLY: not every header applies to every app — confirm the subset this environment requires; and respect the postponed-for-MVP/POC stance rather than forcing a full hardening pass on a throwaway prototype.
