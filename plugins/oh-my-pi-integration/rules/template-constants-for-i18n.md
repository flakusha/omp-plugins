---
name: template-constants-for-i18n
description: "When the application supports constants, dynamic syntax, replacements, handlebars, or any template interpolation, design new named constants/keys for user-visible strings from the start — future i18n and dynamic content slot into the existing keys instead of requiring a full-content sweep"
condition: ["^(?=[\\s\\S]*handlebar|mustache|template (engine|syntax)|\\{\\{|\\{placeholder)(?=[\\s\\S]*i18n|internationaliz|translation|localiz)(?=[\\s\\S]*constant[\\s\\S]{0,40}?(template|html|string)|placeholder[\\s\\S]{0,40}?(key|constant))(?=[\\s\\S]*hardcod[\\s\\S]{0,40}?(string|text|label|button))(?=[\\s\\S]*user-visible (string|text|label))"]
scope: ["text", "thinking"]
---

Constants or template interpolation supported → NEW named constants from the start: user-visible strings become keys, not literals — the default when multi-language or dynamic content is possible.

WHY: i18n later = filling existing keys (retrofit = full sweep, missed strings); dynamic later = same slots, source swaps; the key is the contract — one catalog, one source of truth (see wiring-sync-and-consolidation).

KEY-IFY what a user reads: buttons, labels, titles, headings, errors, aria-labels, toasts, alt text, empty states. NOT structural/invisible strings (ids, classes, data attrs, internal keys).

DON'T OVER-APPLY: no i18n story → apply to NEW code, note the gap, don't invent a framework (see repo-tooling-scoped-usage: discover patterns first); use the project's existing placeholder/constant mechanism, no parallel syntax.
