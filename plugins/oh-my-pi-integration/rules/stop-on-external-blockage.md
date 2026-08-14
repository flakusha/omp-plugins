---
name: stop-on-external-blockage
description: "On GPG/SSH/agent/lock/service blockage, stop and ask the user to resolve it or propose a plan — never unblock by deleting lock files, killing/restarting agents or services, restarting the program/system, or destructive /tmp experiments that disturb shared state"
condition: ["(rm|delete|remove|unlink|rm -f).*\\.lock", "stale lock", "lock file", "kill (gpg|ssh)-agent", "gpgconf --kill", "killall (gpg|ssh|agent)", "systemctl (restart|stop|start)", "service .* (restart|stop)", "restart (the )?(gpg|ssh|agent|daemon|service|harness|program|system)", "\\breboot\\b", "bypass.*(passphrase|pin|pinentry|secret)", "unlock.*(key|gpg|ssh)", "(rm|delete|remove).*/tmp/", "test.*in /tmp"]
scope: ["tool:bash", "text"]
---

When an external system is unavailable or blocked — GPG/SSH signing, ssh-agent/gpg-agent, daemons, lock files, service availability — STOP. Do not attempt recovery by destructive or system-level actions:

- NEVER delete, remove, or rename lock files (`*.lock`, pidfiles) to "clear stale state". Another agent, session, or user may hold that lock right now; removing it breaks their in-flight work.
- NEVER kill or restart agents, daemons, or services (`kill gpg-agent`, `gpgconf --kill`, `killall`, `systemctl restart|stop`, `service … restart`) — parallel agents and human sessions share them.
- NEVER restart the program, harness, or system to "reset state" — a blockage is not a crash; restarting destroys the very locks/agents/states other work depends on.
- NEVER run experiments or tests in `/tmp` that delete, overwrite, or clobber existing files or state as a way to "prove" or clear a blockage. `/tmp` is shared and non-exclusive; a test that `rm`s or writes over an existing path can destroy another agent's working state.

Escalate instead — two allowed paths:
1. Ask the user to resolve the block (they own the keys, agents, services, and credentials).
2. Propose a concrete plan and wait for approval before acting on the "fix" path.

Do not self-authorize destructive recovery. If a lock looks genuinely stale (owning process verifiably dead), still ASK before removing it. Blocked signing or an unavailable agent is a human decision point, not an automation problem — that is exactly why the GPG/SSH guard extension exists: it substitutes a hard-stop directive and blocks self-recovery commands. Match that discipline in your own behavior.

Examples:
- ✗ `gpgconf --kill gpg-agent; …` → ✓ "GPG signing is blocked (secret key unavailable). Please unlock the key, or approve a plan to restart the agent."
- ✗ `rm /tmp/proj.lock; re-run` → ✓ "A lock file exists at /tmp/proj.lock. Is it yours or another agent's? I will not remove it without your confirmation."
- ✗ restarting the harness to clear state → ✓ report the block and the options; let the user decide.
