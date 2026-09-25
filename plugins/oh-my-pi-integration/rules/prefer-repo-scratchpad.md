---
name: prefer-repo-scratchpad
description: "For throwaway tests/experiments/scratch files, use a gitignored in-repository scratch dir (e.g. .tmp/, .scratch/) instead of /tmp — the repo's dependencies, toolchain, and env are already installed and in-scope, with none of the external-folder tooling or permission friction"
condition: ["^(?=[\\s\\S]*test[\\s\\S]{0,40}?in /tmp)(?=[\\s\\S]*(run|create|mkdir|cd)[\\s\\S]{0,40}?/tmp/[\\s\\S]{0,40}?(test|experiment|scratch|fixture|try))(?=[\\s\\S]*(in|to|under) /tmp)(?=[\\s\\S]*/tmp/[\\s\\S]{0,40}?(\\.tmp|scratch|sandbox))(?=[\\s\\S]*mktemp -d)(?=[\\s\\S]*mkdtemp)"]
scope: ["tool:bash", "text"]
---

For throwaway tests/experiments, prefer a gitignored in-repo scratch dir (`.tmp/`, `.scratch/`, `.scratchpad/`, `.work/`) over `/tmp`:
- **Dependencies already installed** — repo `node_modules`/toolchain in scope.
- **Environment already set up** — PATH, config, harness env apply.
- **No external-folder friction** — reads outside the project root are refused; `/tmp` is out of scope.
- Gitignored — never pollutes a commit.
REQUIREMENTS: gitignored (update `.gitignore` if needed); outside the tracked tree — nothing commit-worthy inside; if `.tmp/` is taken, pick a distinct name (`.scratch/`).
EXCEPTION — deliberate target: an installer writing an isolated external dir (`scripts/install.sh` → `/tmp/omp-test`) is fine; a test needing isolation from the tree may use `/tmp` or `$XDG_RUNTIME_DIR`; if it only needs the repo toolchain, stay in-repo.
