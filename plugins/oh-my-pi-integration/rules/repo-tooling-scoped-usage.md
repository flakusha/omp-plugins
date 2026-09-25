---
name: repo-tooling-scoped-usage
description: "Discover and use the repository's scoped tooling (package.json scripts, Makefile, justfile, hooks, CI) instead of ad-hoc or unscoped commands; run the repo's pre-commit and post-changes gates"
condition: ["^(?=[\\s\\S]*node_modules/\\.bin/)(?=[\\s\\S]*bun exec)(?=[\\s\\S]*npx [a-z-]+ )(?=[\\s\\S]*skipping (lint|tests?|typecheck|format|verify))(?=[\\s\\S]*without running (lint|tests?|typecheck|verify))(?=[\\s\\S]*I'll just run)(?=[\\s\\S]*run (tsc|eslint|biome|prettier|vitest|jest|pytest|cargo test|go test) )(?=[\\s\\S]*no (tests?|lint|verify) (exist|found))(?=[\\s\\S]*make (test|lint|check))"]
scope: ["tool:bash", "text"]
---

Before ANY tooling, discover the repo's command surface: `package.json` scripts, `Makefile`/`justfile`/`Taskfile`, hook configs, CI workflows — the canonical scoped invocations. Read them; don't guess.
- SCOPED OVER UNSCOPED: use repo scripts over raw binaries/global tools — they pin versions and flags; never invent commands (known trap: `bun exec biome` fails passthrough; the repo's `bun run lint` works).
- THE GATE IS THE CONTRACT: an ad-hoc "success" while the repo gate fails is a lie.
- PRE-COMMIT: run the repo's pre-commit gate first (unless user says otherwise); fails → fix, don't commit.
- POST-CHANGES: after every edit batch, run the repo's scoped check for the touched area via its own script.
- NO REPO TOOLING? Say so and ask before ad-hoc automation; prefer adding a `package.json` script.
