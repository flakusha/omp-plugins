<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: integrate giwt cli into omp plugin extension

**Status:** ⬜ Not Started
**Priority:** Medium
**Effort:** Medium

## Summary

Replace the hardwired 'bun run scripts/worktree/' tracker prompts with the standalone giwt CLI: extensions/commands/wt.ts detectWtEnv should also detect giwt on PATH (worktreeCli), TRACKER prompt and WT_TOML_TEMPLATE aliases should emit 'giwt <sub>', and finalize.ts hasWorktreeCli likewise. giwt supersedes the REPO_ROOT workaround in buildFinalizePrompt: its loadConfig resolves the main repo root via git rev-parse --git-common-dir from any cwd, so the finalize-from-worktree false negative is fixed at the source.

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
