<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# INFRA: strip agent-harness session env vars in the pre-commit gate

**Status:** done
**Priority:** medium
**Effort:** Small
**Tags:** hooks, isolation

**Summary:**

.githooks/pre-commit:43 builds GATE_ENV with `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE ...` — GIT_* only. The agent harness's own session variables are left in the environment and reach every gate subprocess.

Two failure modes:
1. A gate that reads a session var (OMP_*, PI_*) takes a code path that a human's shell never takes, so the gate's verdict is not the verdict CI will produce.
2. The test suite spawns fixture git repos; an inherited OMP_*/PI_* var that a fixture's git or a spawned tool honours makes the fixture behave differently from a clean checkout.

giwt already hit this class of bug: isolatedGitEnv (giwt/src/utils/git.ts:132-138) strips GIT_* because giwt's whole job is running inside hooks. The same class of leak applies to the harness vars here.

**Context:**

Fix: extend the pre-commit GATE_ENV (and any other gate env) to strip OMP_*, PI_*, ENGRAM_*, MNEMO_* alongside GIT_*.


Evidence: .githooks/pre-commit:41-43

**Acceptance Criteria:**

- [x] The pre-commit gate strips OMP_*, PI_*, ENGRAM_*, MNEMO_* in addition to GIT_*
- [x] The stripped set is defined in one place, not inline in the hook, so it cannot drift
- [x] A test asserts the gate env drops a seeded OMP_*/PI_* var and that gates still pass



- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
