---
name: no-git-stash-shared-branch
description: "Do not run git stash (push/pop/apply/drop) on a branch carrying many uncommitted changes — stash snapshots the whole working tree and index, sweeping up other agents' independent in-flight work in the same branch; commit scoped units instead. Relaxed when each agent works in its own git worktree"
condition: ["(?=[\\s\\S]*git stash( (push|pop|apply|drop|list))?)(?=[\\s\\S]*stash.*(changes|work))(?=[\\s\\S]*\\bstash\\b.*(pop|apply|drop|push))"]
scope: ["tool:bash", "text"]
---

Do NOT run `git stash` (plain, `push`, `pop`, `apply`, `drop`) on a branch that carries many uncommitted changes from this agent or other agents.

Why: a plain `git stash` snapshots the ENTIRE working tree and index of the branch. When several agents work on independent parts of the same branch, one agent's stash sweeps up everyone's uncommitted changes, and a later `pop`/`apply` can silently conflict with or clobber changes that landed in between — suddenly interrupting other agents' ongoing work. `git stash pop`/`apply` are equally risky: they write into the current working tree, which by then may hold other agents' new edits.

Prefer instead, in order:
1. **Commit the current unit of work** — `git add <the files you touched>` then commit. A commit is the durable, conflict-visible boundary; it does not touch anyone else's files.
2. If you must set work aside without committing, use a **pathspec-scoped stash**: `git stash push -- <files you own>` — and verify the pathspec covers only your files, never another agent's.
3. A dedicated branch or worktree is the structural fix; if the situation recurs, propose that to the user.

Relaxed for worktrees: when each agent works in its **own git worktree** (separate working tree per agent), a stash is scoped to that worktree and cannot sweep up other agents' working trees — in that setup this rule can be ignored.

Examples:
- ✗ `git stash` to "pause" work while checking something → ✓ `git add <your files>` + commit, or `git stash push -- <your files>`.
- ✗ `git stash pop` to restore → ✓ commit-based flow, or verify the working tree is still yours before applying.
