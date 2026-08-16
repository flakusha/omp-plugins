---
name: worktree-isolation-for-large-work
description: "Qualify where agent changes land: for large planned work or work needing isolation, prefer a dedicated git worktree (in-repo path, gitignored) when supported; easy changes may land on the current branch unless it is protected by system or repo management"
condition: ["(?=[\\s\\S]*(a lot|large|major|significant|big))(?=[\\s\\S]*(planned work|change|refactor|feature|task))(?=[\\s\\S]*worktree)(?=[\\s\\S]*git worktree)(?=[\\s\\S]*isolation|isolate(d)? (work|changes)?)(?=[\\s\\S]*protected branch|branch protection|protected by)(?=[\\s\\S]*easy change|small change|simple fix|one-line fix)(?=[\\s\\S]*continue (the )?work)(?=[\\s\\S]*which branch|where (should|do)[\\w ]{0,24}work)"]
scope: ["thinking", "text"]
---

Qualify where changes land by scope. Before significant planned work, check whether the repo or harness supports git worktrees; if supported, prefer a dedicated worktree for large work or work that needs isolation. Easy, low-risk changes may land directly on the current branch — but only if that branch is not protected by system or repo management.

Large planned work or isolation needs → dedicated worktree:
- A worktree scopes uncommitted changes to its own working tree: it cannot sweep up or be swept by other agents' working trees on the same branch (this also makes `git stash` safe there — see no-git-stash-shared-branch).
- Parallel agents can work on independent parts of the same branch without interference.
- CREATE IT IN-REPO: in this harness, reads outside the project root are refused, so a sibling worktree (e.g. `../repo-feature`) is unreachable by tooling. Use an in-repo path such as `.worktrees/<name>` under the repo root, and ensure it is gitignored (add `.worktrees/` to `.gitignore` if not covered). Follow the repo's worktree convention if one exists.
- Name it descriptively (`.worktrees/<feature>`), one worktree per unit of work; remove it when merged or abandoned.

Easy changes → current branch, with a check:
- Small, single-purpose, low-risk edits (a few files, no cross-cutting blast radius) may land directly on the current branch.
- EXCEPTION: if the branch is protected by system or repo management (protected branch rules, required reviews, enforced CI, server-side policy), land even easy changes in a worktree or feature branch — never push directly to the protected branch.

Don't over-apply: do not spin up a worktree for a one-line fix, and do not block easy changes behind process. Scale isolation to scope; when in doubt about a boundary, prefer the isolated path. If the environment does not support worktrees at all, state that and continue on the current branch.
