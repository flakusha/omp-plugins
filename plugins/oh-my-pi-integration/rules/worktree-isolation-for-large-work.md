---
name: worktree-isolation-for-large-work
description: "Qualify where agent changes land: for large planned work or work needing isolation, prefer a dedicated git worktree (in-repo path, gitignored) when supported; easy changes may land on the current branch unless it is protected by system or repo management"
condition: ["^(?=[\\s\\S]*(a lot|large|major|significant|big))(?=[\\s\\S]*(planned work|change|refactor|feature|task))(?=[\\s\\S]*worktree)(?=[\\s\\S]*git worktree)(?=[\\s\\S]*isolation|isolate(d)? (work|changes)?)(?=[\\s\\S]*protected branch|branch protection|protected by)(?=[\\s\\S]*easy change|small change|simple fix|one-line fix)(?=[\\s\\S]*continue (the )?work)(?=[\\s\\S]*which branch|where (should|do)[\\w ]{0,24}work)"]
scope: ["thinking", "text"]
---

Large planned work or isolation needs → dedicated git worktree when supported; easy changes may land on the current branch unless protected.

LARGE/ISOLATED → dedicated worktree:
- Changes stay scoped to their own tree: no cross-agent sweeping (`git stash` is harness-blocked on shared branches; in-worktree, scoped pathspecs are safe); parallel agents don't interfere.
- CREATE IN-REPO: tooling can't read outside the project root (`../repo-feature` unreachable) — use gitignored `.worktrees/<name>` (add `.worktrees/` to `.gitignore`); follow any repo convention.
- Descriptive name; one per unit of work; remove when merged or abandoned.

EASY → current branch, with a check: small, single-purpose, low-risk edits (few files, no cross-cutting risk) may land directly — UNLESS the branch is protected (protection rules, required reviews, enforced CI, server-side policy): then a worktree/feature branch, never a direct push.

DON'T OVER-APPLY: no worktree for a one-line fix; don't block easy changes — scale isolation to scope, prefer isolation in doubt; unsupported → say so, stay on the current branch.
