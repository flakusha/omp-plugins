---
name: shell-inline-env-blocklist
description: "When the harness blocks an inline `KEY=value cmd` form (esp. GIT_EDITOR, GIT_SSH, PATH, LD_PRELOAD): the block is upstream policy; route through the tool's `env:` parameter or a re-executable script; do not retry inline forms or chain-prefix to evade"
condition: ["^\\s*(GIT_EDITOR|GIT_SSH|GIT_ASKPASS|GIT_EXTERNAL_DIFF|GIT_SSH_COMMAND|LD_PRELOAD|DYLD_INSERT_LIBRARIES|SSH_ASKPASS|PATH)\\s*=|env[^\\n]{0,40}override"]
scope: ["text", "thinking"]
---

The bash/ctx_shell tool refuses inline `KEY=value cmd` for variables that can redirect which binary runs. Blocked (verified): `PATH` (shadows binaries), `GIT_EDITOR`/`GIT_EXTERNAL_DIFF` (intercept git editor/diff), `GIT_ASKPASS`/`SSH_ASKPASS`/`GIT_SSH`/`GIT_SSH_COMMAND` (intercept credential/ssh prompting; can steal creds), `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES` (library injection). Fires on read and write paths — even `GIT_EDITOR=true git log` is refused. **Deliberate upstream policy** (see `harness-tooling-discipline`).

SANCTIONED:
- Persist: `git config --local core.editor true` (or `--global` → `~/.gitconfig`).
- One-shot via git's flag: `git -c core.editor=true …` — git's own flag, allowed, not inline env.
- One-shot via env: the tool's `env: {"KEY": "value"}` parameter, not inline.
- Complex sequence: re-executable `./.tmp/<name>.{sh,js,py}` invoked via `env:`.

NEVER EVADE (all still fire): other inline shapes (`env KEY=val cmd`, `KEY=val bash -c '…'` — by-name, not by-form); chain-prefix (`cd /tmp && GIT_EDITOR=true git …`); `command`/`builtin`/`/usr/bin/git` forms (see `harness-evasion-guard`); asking the user to run it (bypasses policy, trains the wrong reflex).

VERIFY BEFORE ROUTING: if the block seems wrong, reproduce locally (`git -c core.editor=true commit --allow-empty -m test` confirmed working). Narrow block: only inline overrides of the listed names.
