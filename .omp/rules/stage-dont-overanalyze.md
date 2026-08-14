---
name: stage-dont-overanalyze
description: "On a staging/commit request, stage files and generate the commit message first — surface signing/setup analysis only as a one-line note after staging"
condition: ["serious problem with the commit signing", "configured signing key.*(NOT|not).*(keyring|exist)", "signing (will|would) fail"]
scope: "thinking"
---

When the user asks to stage changes or create a commit, the default response is to act, not analyze: run `git add` on the intended files, review the staged set, and draft the commit message. Do NOT front-load a verbose signing-key/keyring/failure investigation before staging, and do NOT use setup concerns as a reason to postpone staging. If a real blocker exists (e.g. the configured signing key is missing from the keyring), surface it as at most a one-line note *after* staging is done, then let the user resolve it themselves or ask you for follow-up help. The user drives the commit and decides how to handle setup issues.