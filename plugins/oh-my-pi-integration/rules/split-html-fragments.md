---
name: split-html-fragments
description: "If the project supports it, split big HTML files into fragments loaded at render time (includes, partials, components) — each fragment one responsibility, reusable, cacheable; fragments may be dynamic with the same constants/replacements as the main template; if the project prohibits or the stack does not support fragments, keep the file whole and state why"
condition: ["^(?=[\\s\\S]*big html|large html|html file[\\s\\S]{0,40}?(big|large|long|split))(?=[\\s\\S]*fragment|partial|include|component)(?=[\\s\\S]*split[\\s\\S]{0,40}?(html|template|file))(?=[\\s\\S]*server-side include|\\bSSI\\b)(?=[\\s\\S]*render[\\s\\S]{0,40}?(fragment|partial))(?=[\\s\\S]*single-file (html|template))"]
scope: ["text", "thinking"]
---

Where supported, split big HTML files into render-time fragments — includes, partials, components (see split-large-files-classes).

- RESPONSIBILITY: one job per fragment.
- REUSE: shared pieces in one place — one source of truth (see wiring-sync-and-consolidation).
- PERFORMANCE: cache independently, stream incrementally.

USE THE PROJECT'S MECHANISM — includes, partials, components, SSG tooling; never invent one (see repo-tooling-scoped-usage).

PROHIBITED/UNSUPPORTED: if fragments are forbidden (single-file, email HTML, deployment-shape constraints) or unsupported, KEEP THE FILE WHOLE and state the constraint — a forced split is fake structure that breaks the build. Respect it; organize with clear section comments.

FRAGMENTS ARE DYNAMIC: template-constants-for-i18n discipline binds inside fragments exactly as in the parent.
