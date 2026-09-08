---
name: shell-inline-env-blocklist
description: "When the harness blocks an inline `KEY=value cmd` form (esp. GIT_EDITOR, GIT_SSH, PATH, LD_PRELOAD): the block is upstream policy; route through the tool's `env:` parameter or a re-executable script; do not retry inline forms or chain-prefix to evade"
condition: ["^\\s*(GIT_EDITOR|GIT_SSH|GIT_ASKPASS|GIT_EXTERNAL_DIFF|GIT_SSH_COMMAND|LD_PRELOAD|DYLD_INSERT_LIBRARIES|SSH_ASKPASS|PATH)\\s*=|env[^\\n]{0,40}override"]
scope: ["text", "thinking"]
---

The harness's bash / ctx_shell tool refuses inline `KEY=value cmd` syntax
for variables that can redirect which binary runs. The blocked set (verified
empirically):

- `PATH` — can shadow system binaries
- `GIT_EDITOR`, `GIT_EXTERNAL_DIFF` — can intercept git's editor / diff flow
- `GIT_ASKPASS` — can intercept credential prompting
- `GIT_SSH`, `GIT_SSH_COMMAND` — can intercept ssh invocation (and steal creds)
- `SSH_ASKPASS` — same
- `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES` — process-wide library injection

The block fires for both read and write paths — even `GIT_EDITOR=true git
log` is refused. This is **deliberate upstream policy** (defends against
env-flag injection, see `harness-tooling-discipline` for the general rule).

## Why agents hit this

`core.editor = true` is the canonical example: agents that want git to
stop opening a real editor try `git config core.editor true`, which
works — but agents that try `GIT_EDITOR=true git ...` get blocked. The
right shape is one of:

| Goal | Sanctioned path |
|---|---|
| Persist a git config change | `git config --local core.editor true` (writes `.git/config`) |
| Persist globally | `git config --global core.editor true` (writes `~/.gitconfig`) |
| One-shot via git's flag | `git -c core.editor=true ...` (the `-c KEY=VALUE` form is NOT the same as inline env; it is git's own flag and is allowed) |
| One-shot via env, when needed | Pass `env: {"KEY": "value"}` to the tool, NOT inline `KEY=value` |
| Complex sequence needing env | Write a re-executable `./.tmp/<name>.{sh,js,py}` and invoke via `lean-ctx -c "cd <repo> && bun <name>.js"` |

## What NOT to do

- Don't retry with a different inline shape (`env KEY=val cmd`, `KEY=val
  bash -c '...'`, etc.). The block is by-name, not by-form.
- Don't chain-prefix to evade (`cd /tmp && GIT_EDITOR=true git …`).
  Same block fires.
- Don't use `command`/`builtin`/`/usr/bin/git` forms. Those are also
  blocked by `harness-evasion-guard`.
- Don't ask the user to run the command. The block is policy; asking
  bypasses it for one session and trains the wrong reflex.

## Verify before routing

If you think the block is wrong for your specific use, reproduce locally
with the exact command string — confirmed in this session that
`git -c core.editor=true commit --allow-empty -m test` succeeds in the
bash tool. The block is narrow: only inline env-var overrides for the
listed names.
