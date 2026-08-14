/**
 * SSH agent socket hard-stop guard (pure logic — no harness imports, unit-testable).
 *
 * Rationale: when an SSH signing/connection attempt fails because the ssh-agent
 * socket is missing or stale, coding agents habitually go off to "fix" it by
 * killing ssh-agent, deleting or recreating the socket, or forcing an agent
 * (re)start — often silently switching to a DIFFERENT agent (new socket path)
 * whose keys are not loaded, which makes the failure worse. The correct move is
 * to STOP and ask the user to start ssh-agent with keys loaded (or unlock their
 * key) — the agent must never touch ssh-agent's socket or process.
 *
 * This is enforcement, not an AGENTS.md/SKILL.md rule — those are consistently
 * ignored by agents. Real interception happens at the tool_call / tool_result
 * boundary. Mirrors gpg-guard.ts.
 */

/**
 * SSH failure markers that specifically mean "the ssh-agent or its socket is
 * unavailable". Deliberately narrow: things like "Permission denied
 * (publickey)" (wrong/missing key) or "Connection refused"/"connection reset"
 * (network) are NOT here — the agent can legitimately investigate those. A
 * hard stop is reserved for a missing/stale/closed authentication agent, which
 * only a human should restore.
 */
const SSH_SOCK_FAIL_RE = new RegExp(
  [
    String.raw`could\s+not\s+open\s+a\s+connection\s+to\s+your\s+authentication\s+agent`,
    String.raw`error\s+connecting\s+to\s+agent\s*:`,
    String.raw`connect\s+to\s+[^\n]*\bagent\b[^\n]{0,80}\bfailed\b`,
    String.raw`ssh-agent\b[^\n]{0,80}\bno\s+sockets\b`,
    String.raw`(?:SSH_AUTH_SOCK|[a-z0-9._/-]*agent\.\d+)\b[^\n]{0,60}\b(?:no\s+such\s+file|not\s+found|does\s+not\s+exist|stale)\b`,
    String.raw`\bstale\b[^\n]{0,60}\b(?:ssh-agent|SSH_AUTH_SOCK|agent\.\d+|socket)\b`,
    String.raw`authentication\s+agent\s+(?:has\s+no\s+keys|is\s+not\s+running|connection\s+closed)`,
  ].join("|"),
  "i",
);

/**
 * ssh-agent socket / process tampering the agent must never run to "recover"
 * from a connection failure: killing ssh-agent, removing/resetting its socket
 * or runtime dir, or forcibly (re)starting an agent it doesn't own.
 */
const SSH_KILL_RE = new RegExp(
  [
    String.raw`\b(?:kill(?:all)?|pkill|killall)\b`,
    String.raw`\bsystemctl\s+(?:restart|stop|start|reload|kill)\s+ssh-agent\b`,
    String.raw`\bservice\s+ssh-agent\s+(?:restart|stop|start|reload)`,
    String.raw`\bssh-agent\s+-(?:[acCdDkKst])\b`,
    String.raw`\beval\s+\$\s*\(\s*ssh-agent(?:\s+-[acCdDkKst])?\s*\)`,
  ].join("|"),
  "i",
);

/** ssh-agent runtime socket artifacts (paths, env var, sock names). */
const SSH_SOCK_ARTIFACT_RE = new RegExp(
  [
    String.raw`\bSSH_AUTH_SOCK\b`,
    String.raw`\bssh-agent\.sock\b`,
    String.raw`\bagent\.sock\b`,
    String.raw`\b/tmp/ssh-[a-z0-9]+/agent\.\d+\b`,
    String.raw`\bagent\.\d+\b[^\n]{0,40}\b(?:ssh-agent|SSH_AUTH_SOCK)\b`,
  ].join("|"),
  "i",
);

/** True when a bash command tampers with ssh-agent's socket or process. */
export function isSshTamperCommand(cmd: string): boolean {
  if (!cmd) return false;
  // Benign reads of SSH_AUTH_SOCK must never trip the block.
  if (SSH_BENIGN_RE.test(cmd)) return false;

  // Delete / reset / reassign of an agent socket or its env var.
  if (/\b(?:rm|unlink|rmdir)\b[^\n]*\bSSH_AUTH_SOCK\b/.test(cmd)) return true;
  if (/\b(?:rm|unlink|rmdir)\b[^\n]*\bssh-agent\.sock\b/.test(cmd)) return true;
  if (/\b(?:rm|unlink|rmdir)\b[^\n]*\bagent\.sock\b/.test(cmd)) return true;
  if (/\b(?:rm|unlink|rmdir)\b[^\n]*\/?\btmp\/ssh-/.test(cmd)) return true;
  if (/\b(?:rm|unlink|rmdir)\b[^\n]*\bagent\.\d+\b/.test(cmd)) return true;
  if (/\b(?:unset|export)\s+SSH_AUTH_SOCK\b/.test(cmd)) return true;
  if (/^\s*SSH_AUTH_SOCK\s*=/.test(cmd)) return true;

  // Kill / forced-restart intent targeting ssh-agent or a socket artifact.
  if (SSH_KILL_RE.test(cmd) && (/\bssh-agent\b/.test(cmd) || SSH_SOCK_ARTIFACT_RE.test(cmd)))
    return true;
  return false;
}

/**
 * ssh-agent runtime socket activity that's OK to read but a strict guard
 * pattern might hit once `SSH_AUTH_SOCK` is mentioned — benign reads only.
 */
const SSH_BENIGN_RE = new RegExp(
  [
    String.raw`echo\s+\$SSH_AUTH_SOCK`,
    String.raw`ls\s+[^\n]*\$\{?SSH_AUTH_SOCK`,
    String.raw`(?:echo|printf)\s+[^\n]*(?:SSH_AUTH_SOCK|agent\.\d+)`,
    String.raw`test\s+[^\n]*\$SSH_AUTH_SOCK`,
  ].join("|"),
  "i",
);

/** Block reason injected when ssh-agent tampering is attempted. */
export const SSH_BLOCK_REASON =
  "BLOCKED: an SSH/ssh-agent socket failure left the agent unconnectable, which only a human " +
  "can fix. Do not kill/restart ssh-agent, remove or reset its socket or runtime dir, reassign " +
  "SSH_AUTH_SOCK, or eval a new `ssh-agent`. STOP and ask the user to start ssh-agent with their " +
  "keys loaded (or unlock their key); the socket must rest under their control.";

/** True when ssh output shows an agent/socket connection failure. */
export function isSshSockFailure(output: string): boolean {
  return SSH_SOCK_FAIL_RE.test(output);
}

/**
 * Imperative hard-stop directive substituted for the raw SSH error so the
 * model reads it exactly at the failure point. `excerpt` (trimmed, bounded) is
 * the original error preserved for context.
 */
export function sshHardStopDirective(excerpt: string): string {
  const head = excerpt ? `\nSSH error:\n${excerpt.trim().slice(0, 400)}\n` : "\n";
  return (
    "[SSH-HARDSTOP] The SSH operation did NOT complete — ssh-agent is unavailable or the " +
    "authentication socket is missing/stale. Only a human can restore it." +
    head +
    "\n" +
    "OBLIGATORY — DO NOT:\n" +
    "- kill, restart, or relaunch ssh-agent (kill/pkill/killall/systemctl/service/ssh-agent -k)\n" +
    "- remove or reset its socket or runtime dir (rm, unlink, rmdir of SSH_AUTH_SOCK, agent socket)\n" +
    "- reassign or unset SSH_AUTH_SOCK, or `eval $(ssh-agent)` to start a new agent\n" +
    "- retry the ssh/scp/git operation or silently switch to a different socket path\n" +
    "These actions are blocked and must not be attempted.\n\n" +
    "STOP the current task and ask the user to start ssh-agent with their keys loaded " +
    "(or unlock their key). Do not continue until the user confirms the agent is running."
  );
}

/**
 * Decide whether a bash tool result is an SSH agent/socket failure requiring a
 * hard stop. Returns the replacement directive, or `undefined` to let the
 * result pass through untouched.
 */
export function sshSockHardStop(command: string, output: string): string | undefined {
  if (!command) return undefined;
  // Only SSH-family operations can hit an agent/socket failure.
  if (
    !/\bssh\b|\bsftp\b|\bscp\b|\brsync\b|\bsudo\s+ssh\b|\bgit\s+(?:push|fetch|clone|pull)\b/.test(
      command,
    )
  )
    return undefined;
  const out = output ?? "";
  if (!isSshSockFailure(out)) return undefined;
  return sshHardStopDirective(out);
}
