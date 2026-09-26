<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# INFRA: add repo-local giwt.toml for omp-plugins

**Status:** ✅ Done (giwt.toml at repo root: [branches] root=master, [commands] check=bun run verify + test=bun run test, diff_base=false — finalize gates resolve to the repo's own scripts)
**Priority:** Medium
**Effort:** Medium

## Summary

omp-plugins has no 'check' or 'test:unit' npm scripts (it has verify/test), so giwt finalize gates would fail out of the box. Add a local giwt.toml mapping commands.check and commands.test to the repo's own gates (e.g. check = 'bun run typecheck', test = 'bun run test') once giwt is adopted here.

## Acceptance Criteria

- [x] Implementation complete (commit 2a3976c added giwt.toml + pre-commit gate; test = "bun run test" added so commands.test no longer defaults to the missing test:unit script)
- [x] Tests passing (giwt-config.test.ts + check-shipment install round-trip green)
- [x] Documentation updated (README lifecycle section)
