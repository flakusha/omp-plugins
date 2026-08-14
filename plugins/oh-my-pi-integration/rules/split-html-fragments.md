---
name: split-html-fragments
description: "If the project supports it, split big HTML files into fragments loaded at render time (includes, partials, components) — each fragment one responsibility, reusable, cacheable; fragments may be dynamic with the same constants/replacements as the main template; if the project prohibits or the stack does not support fragments, keep the file whole and state why"
condition: ["(?=[\\s\\S]*big html|large html|html file.*(big|large|long|split))(?=[\\s\\S]*fragment|partial|include|component)(?=[\\s\\S]*split.*(html|template|file))(?=[\\s\\S]*server-side include|\\bSSI\\b)(?=[\\s\\S]*render.*(fragment|partial))(?=[\\s\\S]*single-file (html|template))"]
scope: ["text", "thinking"]
---

If the project supports it, split big HTML files into fragments loaded at render time — includes, partials, or components. Big markup files have the same problem as big code files (see split-large-files-classes): hard to read, hard to change, one responsibility buried among many.

WHY FRAGMENTS:
- RESPONSIBILITY: each fragment has one job (header, nav, footer, card, form) — the same cohesion axis as split-large-files-classes, applied to markup.
- REUSE: shared pieces live in one place and are included everywhere — one source of truth, not N copied blocks (see wiring-sync-and-consolidation).
- PERFORMANCE: fragments cache independently and can stream/render incrementally.

USE THE PROJECT'S MECHANISM — server-side includes, template partials, component systems, static-site include tooling. Do not invent a parallel mechanism (see repo-tooling-scoped-usage). A fragment system is only as good as the project's support for it.

MAY BE PROHIBITED OR UNSUPPORTED — then do not fight the constraint:
- If the project forbids fragments (single-file constraint, email HTML, certain static exports, strict deployment shape) or the stack simply does not support them, KEEP THE FILE WHOLE and state the constraint explicitly — a forced "split" into an unsupported mechanism is fake structure that breaks the build.
- A single-file constraint is a legitimate design decision; respect it and keep the file organized with clear section comments instead.

FRAGMENTS ARE DYNAMIC LIKE EVERYTHING ELSE: within each fragment, apply the same constants/replacements discipline as the main template (see template-constants-for-i18n) — dynamic content and i18n keys bind inside fragments exactly as they do in the parent.
