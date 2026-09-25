---
name: stop-on-external-blockage
description: "On GPG/SSH/agent/lock/service blockage, stop and ask the user to resolve it or propose a plan — never unblock by deleting lock files, killing/restarting agents or services, restarting the program/system, or destructive /tmp experiments that disturb shared state"
condition: ["^(?=[\\s\\S]*(rm -f|rm|delete|remove|unlink))(?=[\\s\\S]*\\.lock)(?=[\\s\\S]*stale lock)(?=[\\s\\S]*lock file)(?=[\\s\\S]*kill (gpg|ssh)-agent)(?=[\\s\\S]*gpgconf --kill)(?=[\\s\\S]*killall (gpg|ssh|agent))(?=[\\s\\S]*systemctl (restart|stop|start))(?=[\\s\\S]*service)(?=[\\s\\S]*(restart|stop))(?=[\\s\\S]*restart (the )?(gpg|ssh|agent|daemon|service|harness|program|system))(?=[\\s\\S]*\\breboot\\b)(?=[\\s\\S]*bypass)(?=[\\s\\S]*(passphrase|pin|pinentry|secret))(?=[\\s\\S]*unlock)(?=[\\s\\S]*(key|gpg|ssh))(?=[\\s\\S]*(rm|delete|remove))(?=[\\s\\S]*/tmp/)(?=[\\s\\S]*test)(?=[\\s\\S]*in /tmp)"]
scope: ["tool:bash", "text"]
---

When an external system is unavailable or blocked — GPG/SSH signing, ssh-agent/gpg-agent, daemons, lock files, services — STOP. Never self-recover destructively:

- NEVER delete/rename lock files/pidfiles to "clear stale state" — may be held.
- NEVER kill/restart agents, daemons, or services (`gpgconf --kill`, `killall`, `systemctl restart|stop`) — shared.
- NEVER restart the program/harness/system to "reset state" — restarting destroys state other work depends on.
- NEVER run `/tmp` experiments that delete/overwrite existing state — `/tmp` is shared.

ESCALATE — two allowed paths:
1. Ask the user to resolve the block (they own the keys/services).
2. Propose a concrete plan and wait for approval before acting on the "fix" path.

No self-authorized destructive recovery: even a verifiably stale lock → ASK first. Blocked signing is a human decision point — match the GPG/SSH guard's hard-stop discipline.
Example: ✗ `gpgconf --kill gpg-agent` → ✓ "GPG signing is blocked — please unlock the key."
