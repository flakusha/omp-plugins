---
name: repo-tooling-scoped-usage
description: "Discover and use the repository's scoped tooling (package.json scripts, Makefile, justfile, hooks, CI) instead of ad-hoc or unscoped commands; run the repo's pre-commit and post-changes gates"
condition: ["node_modules/\\.bin/", "bun exec", "npx [a-z-]+ ", "skipping (lint|tests?|typecheck|format|verify)", "without running (lint|tests?|typecheck|verify)", "I'll just run", "run (tsc|eslint|biome|prettier|vitest|jest|pytest|cargo test|go test) ", "no (tests?|lint|verify) (exist|found)", "make (test|lint|check)"]
scope: ["tool:bash", "text"]
---

Before running ANY tooling, discover the repository's command surface — the repo defines how its own tools are invoked:
- `package.json` scripts (incl. `bun`/`npm`/`yarn`/`pnpm`), `Makefile`/`justfile`/`Taskfile`, `.pre-commit-config.yaml`, `lefthook.yml`, `.husky/`, CI workflow files.
These are the canonical, scoped invocations. Read them; do not guess.

Scoped over unscoped:
- Use the repo script (`bun run lint`, `make test`) over raw binaries (`./node_modules/.bin/biome …`) and over globally-installed tools. Repo scripts encode the pinned versions and the exact flags the project maintains.
- A repo-scoped failure is a real signal; an ad-hoc invocation that "works" while the repo's own gate fails is a lie — the gate is the contract.
- Never invent commands: if `bun exec <tool>` or `npx <tool>` is not how the repo calls it, don't use it; read the script definition. (Known trap: `bun exec biome` fails passthrough while the repo's `bun run lint` works.)

Pre-commit:
- When a commit is requested, first run the repo's defined pre-commit gate (a `verify`/`precommit` script, or the configured hooks: husky, lefthook, pre-commit, lint-staged) unless the user says otherwise. If the gate is defined and fails, do not commit — fix the failure instead.

Post-changes:
- After every batch of edits, run the repo's scoped check for the touched area (test, typecheck, lint) using the project's own script — not a bespoke command. If the repo defines a single gate (e.g. `verify`), use it and treat its exit code as authoritative.

No repo tooling exists?
- Say so explicitly and ask before introducing ad-hoc automation. Prefer adding a script to `package.json` over a one-off command that only you know about — an undocumented command is unscoped tooling by another name.
