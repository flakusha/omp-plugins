<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: integrate giwt cli into omp plugin extension

**Status:** ✅ Done (detectWtEnv/hasWorktreeCli detect giwt on PATH; tracker prompt + /wt init aliases emit `giwt <sub>`; REPO_ROOT workaround dropped from the giwt finalize prompt — loadConfig resolves the main root via git rev-parse --git-common-dir from any cwd)
**Priority:** Medium
**Effort:** Medium

## Summary

Replace the hardwired 'bun run scripts/worktree/' tracker prompts with the standalone giwt CLI: extensions/commands/wt.ts detectWtEnv should also detect giwt on PATH (worktreeCli), TRACKER prompt and WT_TOML_TEMPLATE aliases should emit 'giwt <sub>', and finalize.ts hasWorktreeCli likewise. giwt supersedes the REPO_ROOT workaround in buildFinalizePrompt: its loadConfig resolves the main repo root via git rev-parse --git-common-dir from any cwd, so the finalize-from-worktree false negative is fixed at the source.

## Acceptance Criteria

- [x] Implementation complete (extensions/commands/{wt,finalize}.ts: giwt-on-PATH detection, `giwt <sub>` tracker prompt + /wt init template aliases, REPO_ROOT instruction removed for the giwt path)
- [x] Tests passing (wt.test.ts 12+ cases, finalize.test.ts hermetic via pathEnv; full suite 1279/1279)
- [x] Documentation updated (README lifecycle section)
