---
name: authorization-confirmed
description: "For API, DB access implementations — confirm access is actually allowed: server-side, per entry point and per resource, on user permissions/scopes/tokens; default-deny; never rely on hidden UI or unguessable ids"
condition: ["authoriz|permission|role|scope|acl|token|access (control|check|level|granted)", "allow|deny|unauthorized|forbidden|403|route|endpoint|handler|middleware", "api|database|db|read (a )?(record|row)|fetch (a )?(record|row)|expose"]
scope: ["text", "thinking"]
---

For API and DB-access implementations, CONFIRM access is actually allowed — authorization is verified, never assumed.

THE RULE — check each:
- SERVER-SIDE, PER ENTRY POINT: every route/endpoint/handler and every DB-access path checks the caller's identity and permission — server-side. Never rely on client-side hiding, an absent UI link, or "the endpoint just isn't advertised" for security.
- TOKENS: confirm token validity, expiry, scope, and revocation are enforced; verify a token's signature and issuer before trusting its claims — do not trust presented claims as fact.
- DEFAULT-DENY: unknown/absent/unauthenticated is denied; permissive-by-default is a bug. Check the error/negative path, not just the happy path (see strict-review-standards).
- RESOURCE-LEVEL (row-level) AUTHORIZATION: authorization applies per resource, not only per route — a user may fetch their own record but not another's. This is the IDOR class: an unguessable id is NOT authorization (see unique-identifiers-confirmed).
- EXPLICIT TRUST BOUNDARY: internal service-to-service paths that skip per-call auth must be an explicit, documented trust boundary (mTLS/network isolation), not an assumption.

WHY: authorization is the security boundary of the implementation. Confirming it on every entry point, server-side, default-deny, at the resource level, closes the bulk of real API/DB vulnerabilities (IDOR, token misuse, authz bypass).

TIES: unique-identifiers-confirmed (IDOR), api-input-validation, strict-review-standards, sql-injection-free.

DON'T OVER-APPLY: internal-only service-to-service paths with real mTLS/network isolation may legitimately not re-check per call — but that is an explicit, documented trust boundary, and confirm it is what actually exists, not an assumption.
