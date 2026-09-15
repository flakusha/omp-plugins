<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# INFRA: add repo-local giwt.toml for omp-plugins

**Status:** ⬜ Not Started
**Priority:** Medium
**Effort:** Medium

## Summary

omp-plugins has no 'check' or 'test:unit' npm scripts (it has verify/test), so giwt finalize gates would fail out of the box. Add a local giwt.toml mapping commands.check and commands.test to the repo's own gates (e.g. check = 'bun run typecheck', test = 'bun run test') once giwt is adopted here.

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
