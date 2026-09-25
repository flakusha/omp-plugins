---
name: authorization-confirmed
description: "For API, DB access implementations — confirm access is actually allowed: server-side, per entry point and per resource, on user permissions/scopes/tokens; default-deny; never rely on hidden UI or unguessable ids"
condition: ["^(?=[\\s\\S]*authoriz|permission|role|scope|acl|token|access (control|check|level|granted))(?=[\\s\\S]*allow|deny|unauthorized|forbidden|403|route|endpoint|handler|middleware)(?=[\\s\\S]*api|database|db|read (a )?(record|row)|fetch (a )?(record|row)|expose)"]
scope: ["text", "thinking"]
---

For API and DB-access implementations, CONFIRM access is actually allowed — verified, never assumed:

- SERVER-SIDE, PER ENTRY POINT: every route/endpoint/handler and DB-access path checks caller identity and permission server-side. Never rely on client-side hiding, an absent UI link, or an unadvertised endpoint for security.
- TOKENS: enforce validity, expiry, scope, revocation; verify signature and issuer before trusting claims.
- DEFAULT-DENY: unknown/absent/unauthenticated is denied; permissive-by-default is a bug. Check the error/negative path (see strict-review-standards).
- RESOURCE-LEVEL (row-level): authorization applies per resource, not only per route — a user may fetch their own record but not another's. This is the IDOR class: an unguessable id is NOT authorization (see unique-identifiers-confirmed).
- EXPLICIT TRUST BOUNDARY: internal service-to-service paths skipping per-call auth must be an explicit, documented trust boundary (mTLS/network isolation), not an assumption.

WHY: authorization is the security boundary; confirming it per entry point, server-side, default-deny, at resource level closes the bulk of real API/DB vulnerabilities (IDOR, token misuse, authz bypass).

TIES: unique-identifiers-confirmed (IDOR), api-input-validation, strict-review-standards, sql-injection-free.

DON'T OVER-APPLY: internal-only service-to-service paths with real mTLS/network isolation may skip per-call re-checks — but confirm that boundary actually exists and is documented, not assumed.
