---
name: worktree-isolation-for-large-work
description: "Qualify where agent changes land: for large planned work or work needing isolation, prefer a dedicated git worktree (in-repo path, gitignored) when supported; easy changes may land on the current branch unless it is protected by system or repo management"
condition: ["^(?=[\\s\\S]*(a lot|large|major|significant|big))(?=[\\s\\S]*(planned work|change|refactor|feature|task))(?=[\\s\\S]*worktree)(?=[\\s\\S]*git worktree)(?=[\\s\\S]*isolation|isolate(d)? (work|changes)?)(?=[\\s\\S]*protected branch|branch protection|protected by)(?=[\\s\\S]*easy change|small change|simple fix|one-line fix)(?=[\\s\\S]*continue (the )?work)(?=[\\s\\S]*which branch|where (should|do)[\\w ]{0,24}work)"]
scope: ["thinking", "text"]
---

Large planned or isolated work → dedicated git worktree when supported; easy changes may land on the current branch unless protected.

LARGE/ISOLATED → dedicated worktree:
- Changes stay scoped to their own tree — other agents can't sweep them; parallel agents don't interfere.
- CREATE IN-REPO: tooling can't read outside the repo root (../repo-feature would be unreachable); use gitignored `.worktrees/<name>` (add `.worktrees/` to `.gitignore`); follow repo conventions.
- Name descriptively; one per unit; remove when merged or abandoned.

EASY → current branch, checked: small, single-purpose, low-risk edits (few files, no cross-cutting blast) land directly — UNLESS the branch is protected (branch protection, required reviews, enforced CI, server policy): then worktree/feature branch, never a direct push.

DON'T OVER-APPLY: no worktree for a one-line fix; don't block easy changes — scale isolation to scope, prefer it in doubt; unsupported → say so, continue on the current branch.
