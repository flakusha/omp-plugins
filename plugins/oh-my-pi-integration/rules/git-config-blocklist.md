---
name: git-config-blocklist
description: "When `git config` mutation is blocked (set/unset/edit/--add/--unset/rename-section/legacy key-value writes): persistent config changes are strictly prohibited for all agents and subagents; reads stay allowed; one-shot `git -c key=value` is the sanctioned override; persistent changes need the user (ask)"
condition: ["git\\s+config\\s|git config (set|unset|edit|mutation|write|block)|persistent config (write|change|mutation)"]
scope: ["text", "thinking"]
---

Persistent `git config` mutation is strictly prohibited for all agents and subagents — config writes change behavior for every future session and every other agent on the machine (editor hijack, credential-helper swap, alias injection are persistence attacks, not workflow).

BLOCKED (verified): `git config <key> <value>` (legacy two-positional write), `git config set/unset/edit <…>` (git >= 2.46 subcommands), `--add`, `--replace-all`, `--unset`, `--unset-all`, `--remove-section`, `--rename-section`, `--edit`/`-e`, any `--global`/`--system`/`--local`/`--worktree`/`-f <file>`/`--file <file>`/`--blob <blob>` scope combined with a write. Evasion/chain forms (`cd x && git config …`, `git -C x config …`, `bash -c "git config …"`, `command`/`builtin`/`/usr/bin/git`) are blocked by `harness-evasion-guard`.

ALLOWED (reads): `git config --get <key>`, `--get-all`, `--get-regexp <re>`, `--list`/`-l`, `git config get/list <…>` (>= 2.46), single-positional `git config <key>`.

SANCTIONED:
- One-shot override: `git -c key=value <command>` — git's own flag, not persisted, allowed.
- Persistent change: needs the user (ask). State the exact key/value/scope and stop; the user runs it or authorizes explicitly. Bootstrap scripts that write config (e.g. `.githooks/.install.sh` → `core.hooksPath`) are user-run setup, not agent work.

NEVER EVADE: quoted-token forms, chain prefixes, wrapper prefixes — the guard segments and normalizes; retrying shapes re-fires. A block on a legitimately needed persistent setting is an ASK, not a workaround (see `harness-tooling-discipline`).

KNOWN LIMITS (static analysis, errs closed): `git config --get <name> <value-pattern>` (read with two positionals) matches the legacy-write shape — use `--get-regexp` instead; keys literally starting `get.`/`list.` are excluded from write detection; targets hidden in `$()`/process substitution are not resolved.
