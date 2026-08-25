---
name: no-git-stash-blocked
description: "Hard block on git stash (push/pop/apply/drop/clear) in shared-branch agent flows. The existing no-git-stash-shared-branch rule nudges; this rule gates — agents repeatedly run stash despite the recommendation and sweep each other's in-flight work. Use git worktree isolation or commit the change instead."
condition: ["^(?=[\\s\\S]*\\bgit\\b[\\s\\S]{0,30}?\\bstash\\b)(?=[\\s\\S]*\\bstash\\b(?:[\\s\\S]{0,40}?(push|pop|apply|drop|clear|store|branch|show|list|create))?)(?=[\\s\\S]*\\bgit\\s+stash\\b)(?![\\s\\S]*\\s--\\s+\\S)"]
scope: ["tool:bash"]
---

# Hard block — do NOT run `git stash` in this agent flow

The existing rule `no-git-stash-shared-branch` is a recommendation; it has
been ignored repeatedly. This rule is a gate. It fires on any of:

- `git stash` (plain, no subcommand)
- `git stash push` / `git stash pop` / `git stash apply` / `git stash drop`
- `git stash clear` / `git stash store` / `git stash branch` / `git stash show`
- `git stash list` / `git stash create`

## Why hard-block

When several agents (or one agent across multiple turns, or one agent
re-invoked from compaction) work on the **same branch**, a `git stash`
snapshots the entire working tree and index of that branch. Other agents'
in-flight edits get swept into the stash. A subsequent `pop`/`apply`
restores them, but in the meantime:

1. The agent that ran the stash may `pop` into a working tree that has
   moved on — silent conflicts or clobbers.
2. The agent whose work was swept loses the live state of its working
   tree; commits that were about to happen never happen.
3. Cross-agent contamination is undetectable at review time: the diff
   just looks like work that "appeared".

Recommendation-only rules don't work here because the cost is asymmetric:
the agent that runs the stash pays nothing, the agents whose work gets
swept pay everything. The correct guard is a hard gate.

## What does NOT fire (safe shapes)

The rule does NOT fire on:

- `git stash push -- <pathspec>` — pathspec-scoped stash; only the named
  files are swept, which is safe for paths the agent owns outright.
- `git stash push -- <pathspec> <other args>` — same; the `--` followed by
  a non-flag token is the safe shape.

The rule DOES fire on `git stash push --keep-index`, `--quiet`, `--all`,
or any other non-pathspec `--flag` form. Those still snapshot the entire
worktree (modulo the flag's tweak), which is the sweep risk. To make
`--keep-index` safe, scope it: `git stash push --keep-index -- <files>`.

## What to do instead

In order of preference:

1. **Commit the current unit of work** —
   `git add <the files you touched>` then `git commit -m "..."`. A commit
   is the durable, conflict-visible boundary and touches no one else's
   files.
2. **Use a dedicated git worktree** — `git worktree add ../repo-fix-N`
   creates an isolated working tree where stash is local and can't sweep
   up other agents' work. This is the structural fix when the situation
   recurs.
3. **If you must set uncommitted work aside**: use the pathspec-scoped
   form `git stash push -- <files you own>`. Verify with `git status`
   (NOT `git status` for investigation — only to confirm the pathspec
   caught only your files) that nothing else is in the stash.

## Do NOT do

- ✗ `git stash` (plain) — sweeps the entire working tree.
- ✗ `git stash pop` / `git stash apply` — restores into a working tree
  that may have moved on; can clobber or conflict with other agents'
  work that landed in between.
- ✗ `git stash drop` / `git stash clear` — destroys stashed work that
  may belong to another agent; irrecoverable.
- ✗ `git stash branch` — creates a branch from a stash snapshot; same
  sweep risk.

## When this rule is relaxed

This rule is relaxed only when:

- each agent works in its **own git worktree** (separate working tree
  per agent), so a stash is local to one worktree and cannot sweep up
  another worktree's working tree;
- the user has explicitly authorized a one-off stash for a specific
  purpose (e.g. "stash my changes, I'm switching branches") — in which
  case the user has accepted the risk.

Neither condition is the default. Default: do not run `git stash`.
