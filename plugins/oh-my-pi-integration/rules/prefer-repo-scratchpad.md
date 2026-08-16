---
name: prefer-repo-scratchpad
description: "For throwaway tests/experiments/scratch files, use a gitignored in-repository scratch dir (e.g. .tmp/, .scratch/) instead of /tmp — the repo's dependencies, toolchain, and env are already installed and in-scope, with none of the external-folder tooling or permission friction"
condition: ["^(?=[\\s\\S]*test[\\s\\S]{0,40}?in /tmp)(?=[\\s\\S]*(run|create|mkdir|cd)[\\s\\S]{0,40}?/tmp/[\\s\\S]{0,40}?(test|experiment|scratch|fixture|try))(?=[\\s\\S]*(in|to|under) /tmp)(?=[\\s\\S]*/tmp/[\\s\\S]{0,40}?(\\.tmp|scratch|sandbox))(?=[\\s\\S]*mktemp -d)(?=[\\s\\S]*mkdtemp)"]
scope: ["tool:bash", "text"]
---

For throwaway tests, experiments, and scratch files, prefer a gitignored in-repository scratch dir (conventional names: `.tmp/`, `.scratch/`, `.scratchpad/`, `.work/`) over `/tmp`. Pure wins:

- **Dependencies already installed** — the repo's `node_modules`, toolchain (bun, tsc, biome), and pinned versions are present and in scope; no reinstall or absolute-path juggling.
- **Environment already set up** — PATH, config, and harness env apply; nothing to recreate.
- **No external-folder friction** — no tooling or permission hurdles to access an outside folder. In this harness, reads outside the project root are refused, so an in-repo scratch stays in scope and readable; a `/tmp` scratch is out of scope and needs workarounds.
- The scratch dir is gitignored, so it never pollutes a commit.

Requirements:
- Ensure the scratch dir is gitignored; if `.gitignore` does not already cover it, add it before using it.
- Keep scratch inside the repo but out of the tracked tree; never put anything in it that should be committed.
- If the conventional `.tmp/` name is already taken in this repo (e.g. by a symlink or another purpose), pick a distinct name (`.scratch/`) rather than reusing or overwriting it.

Exception — this is a deliberate target, not a scratch test:
- A deployment/installer that intentionally writes an isolated external dir (e.g. `scripts/install.sh` → `/tmp/omp-test`) is expected and fine — it is a deployment target, not throwaway scratch.
- A test that genuinely needs a clean, isolated environment detached from the working tree may still use `/tmp` or `$XDG_RUNTIME_DIR`; but when a test only needs the repo's own toolchain, use the in-repo scratch.
