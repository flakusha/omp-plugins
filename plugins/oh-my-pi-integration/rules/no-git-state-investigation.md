---
name: no-git-state-investigation
description: "During implementation tasks, do not investigate git working-tree state (status/rev-parse/dirty counts); implement on the assigned branch directly."
condition: ["(?=[\\s\\S]*git\\s+status)(?=[\\s\\S]*git\\s+rev-parse)(?=[\\s\\S]*git\\s+branch\\s+--show-current)(?=[\\s\\S]*\\bdirty\\b[^\\n]*\\b(entries|files|count)\\b)(?=[\\s\\S]*investigate.*git\\s+state)"]
scope: ["tool:bash"]
---

Stop auditing git state. The user assigned you a branch for the change and asked for code work — implement it directly. Do NOT run `git status`, `git rev-parse`, or `git branch --show-current`, and do NOT tally dirty files to 'understand the working tree' before editing. Pre-existing uncommitted files are not yours to inspect or sweep; stage only the files you changed for this task at commit time (e.g. `git add <the dirs you touched>/`). Investigate the code, not the repo bookkeeping.
