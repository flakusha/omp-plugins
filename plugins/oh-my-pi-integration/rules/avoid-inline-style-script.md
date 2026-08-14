---
name: avoid-inline-style-script
description: "In HTML, use inline style attributes and <style>/<script> blocks only when deadly necessary (e.g. framework init snippets) — external assets cache, keep CSP clean, and separate concerns; check the project's asset pipeline and CSP conventions first"
condition: ["(?=[\\s\\S]*inline (style|script|css|js))(?=[\\s\\S]*<style>|<script|</script>)(?=[\\s\\S]*style=\\s*\"|style=\\s*')(?=[\\s\\S]*onclick=|onload=|onerror=)(?=[\\s\\S]*CSP|content-security-policy)(?=[\\s\\S]*external (style|script|css|js))(?=[\\s\\S]*style attribute)"]
scope: ["text", "thinking"]
---

In HTML, use inline `style` attributes and `<style>`/`<script>` blocks only when deadly necessary. Inline code in markup is the last resort, not the default.

WHY EXTERNAL WINS:
- CSP: strict Content-Security-Policy blocks inline scripts and styles — inline usage either forces a weaker CSP or breaks under the security boundary the project ships.
- CACHING: external assets cache across pages; inline code re-downloads and re-parses with every document.
- CONCERNS: markup, presentation, and behavior stay separate; one place to change instead of N inline copies (see wiring-sync-and-consolidation: one source of truth).

WHEN INLINE IS LEGITIMATE (deadly necessary):
- FRAMEWORK INIT: bootstrapping snippets that must run before external scripts load (e.g. framework init, config seeding).
- Single-file deliverables where external files are impossible: email HTML, standalone tools, exported single-file pages — and even then, note the CSP tradeoff.
- Only when a real constraint demands it — never for convenience or "it's a small snippet" (a small snippet belongs in the external file too).

THE PATTERN: `<link rel="stylesheet">` and `<script src>` with the project's asset pipeline (bundler output, hashed filenames, local-first). Follow the project's existing asset conventions (see repo-tooling-scoped-usage) — including its CSP: if the project ships a strict CSP, inline anything and you have already broken the policy.
