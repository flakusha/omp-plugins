---
name: template-constants-for-i18n
description: "When the application supports constants, dynamic syntax, replacements, handlebars, or any template interpolation, design new named constants/keys for user-visible strings from the start — future i18n and dynamic content slot into the existing keys instead of requiring a full-content sweep"
condition: ["handlebar|mustache|template (engine|syntax)|\\{\\{|\\{placeholder", "i18n|internationaliz|translation|localiz", "constant.*(template|html|string)|placeholder.*(key|constant)", "hardcod.*(string|text|label|button)", "user-visible (string|text|label)"]
scope: ["text", "thinking"]
---

When the application supports constants, dynamic syntax, replacements, handlebars, or any template interpolation, design NEW named constants from the start — every user-visible string becomes a key/placeholder, not a hardcoded literal.

WHY:
- FUTURE i18n BECOMES TRIVIAL: translation = filling values into keys that already exist. Retrofitting i18n to hardcoded strings is a full-content sweep over every page, with missed-string bugs in between.
- FUTURE DYNAMIC CONTENT BECOMES TRIVIAL: dynamic data binds to the same slots the constants occupy — the placeholder is already there; only the source changes.
- THE CONSTANT IS THE CONTRACT: the key lives in one catalog (message file, constants module, i18n dictionary); templates reference it. One source of truth (see wiring-sync-and-consolidation) — and a hardcoded user-facing string is just a magic value in markup.

WHAT GETS A CONSTANT: button text, labels, titles, headings, errors, aria-labels, toasts, alt text, empty states — anything a user reads. The moment the app may ever ship in more than one language or render dynamic content, the key is the default.

WHAT DOES NOT: structural, non-visible strings — ids, classes, data attributes, internal keys that users never read. Do not key-ify the invisible.

DON'T OVER-APPLY:
- Follow the project's templating and i18n conventions; if the project has no i18n story and hardcodes everything, introduce the constants discipline for NEW code and note the gap rather than inventing a full i18n framework (see repo-tooling-scoped-usage: discover patterns first).
- Do not invent a parallel syntax when the project already has one — use its existing placeholder/constant mechanism.
