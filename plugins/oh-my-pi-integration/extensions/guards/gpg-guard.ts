/**
 * GPG signing hard-stop guard (pure logic — no harness imports, unit-testable).
 *
 * Rationale: when `git commit` / `gpg` signing fails because the secret key is
 * locked or unavailable, coding agents habitually go off to "discover the gpg
 * config" or restart `gpg-agent` instead of stopping. That self-recovery is
 * wrong: a locked key needs a HUMAN to unlock it (pinentry passphrase or
 * smartcard). This module detects the failure and produces an imperative
 * hard-stop directive; the wiring in index.ts substitutes that directive for
 * the raw error (so the model reads it at the failure point) and blocks
 * gpg-agent lifecycle / passphrase-bypass commands outright.
 *
 * This is enforcement, not an AGENTS.md/SKILL.md rule — those are consistently
 * ignored by agents. Real interception happens at the tool_call / tool_result
 * boundary.
 */

/** Signing-failure markers in git/gpg stderr that mean "key locked / cannot sign". */
const GPG_SIGN_FAIL_RE = new RegExp(
  [
    String.raw`gpg:\s*signing failed`,
    String.raw`gpg:\s*failed to sign the data`,
    String.raw`gpg:\s*can['’]t sign data`,
    String.raw`gpg:\s*(?:signing|decryption)\s*failed[:\s]+no secret key`,
    String.raw`secret key not available`,
    String.raw`no secret key available`,
    String.raw`gpg failed to sign the data`,
    String.raw`commit signing failed`,
    String.raw`error signing data`,
    String.raw`signing failed:`,
    String.raw`inappropriate ioctl for device`,
    String.raw`cannot open pinentry`,
    String.raw`pinentry\s*(?:cannot|failed|could not|missing)`,
  ].join("|"),
  "i",
);

/**
 * gpg-agent lifecycle / passphrase-bypass commands the agent must never run to
 * "recover" from a signing failure. Reading config is NOT matched: only
 * restart/relaunch/reload/forced-passphrase operations are.
 */
const GPG_TAMPER_RE = new RegExp(
  [
    String.raw`\bgpgconf\s+--(?:kill|launch|reload|homedir|change-options|create-socketdir|remove-socketdir)\b`,
    String.raw`\bgpg-connect-agent\b[^\n]*(?:killagent|reloadagent|--reload)`,
    String.raw`\bgpg-agent\s+--(?:daemon|supervised|homedir|options)`,
    String.raw`\bgpg\b[^\n]*--pinentry-mode\s+loopback`,
    String.raw`\bgpg\b[^\n]*--passphrase\b`,
    String.raw`\bgpg\b[^\n]*--pinentry-program\b`,
  ].join("|"),
  "i",
);

/**
 * A kill/restart/force-reload intent word targeting gpg-agent or gpgconf. The
 * kill family is matched separately from the target (anywhere in the command)
 * so intervening flags (`-f`, `-9`, `$(pgrep ...)`) don't defeat detection.
 */
const GPG_KILL_TARGET_RE = /\b(gpg-agent|gpgconf|gpg-connect-agent)\b/i;
const GPG_KILL_INTENT_RE =
  /\b(?:kill(?:all)?|pkill|killall)\b|\bsystemctl\s+(?:restart|stop|start|reload|kill)\b|\bservice\s+[^\s]*\s+(?:restart|stop|start|reload)\b|\bgpg-connect-agent\b[^\n]*\bkilla?gent\b|\bgpgconf\s+--(?:kill|launch|reload)\b/i;

/** True when a bash command tampers with gpg-agent lifecycle or forces a passphrase. */
export function isGpgTamperCommand(cmd: string): boolean {
  if (!cmd) return false;
  if (GPG_TAMPER_RE.test(cmd)) return true;
  // Broad kill/restart intent + a gpg agent target anywhere in the command.
  if (!GPG_KILL_INTENT_RE.test(cmd)) return false;
  return GPG_KILL_TARGET_RE.test(cmd);
}

/** Block reason injected when a gpg-agent tamper command is attempted. */
export const GPG_BLOCK_REASON =
  "BLOCKED: a GPG signing failure left the secret key locked, which only a human can unlock. " +
  "Do not inspect or modify gpg config, restart/kill/reload gpg-agent or gpgconf, force a passphrase, " +
  "or use --pinentry-mode loopback. STOP and ask the user to unlock their GPG key " +
  "(pinentry passphrase or smartcard), then have them re-run the commit.";

/** True when git/gpg output shows a GPG signing/unlock failure. */
export function isGpgSignFailure(output: string): boolean {
  return GPG_SIGN_FAIL_RE.test(output);
}

/**
 * Imperative hard-stop directive substituted for the raw signing error so the
 * model reads it exactly at the failure point. `excerpt` (trimmed, bounded) is
 * the original signing error preserved for context.
 */
export function gpgHardStopDirective(excerpt: string): string {
  const head = excerpt ? `\nSigning error:\n${excerpt.trim().slice(0, 400)}\n` : "\n";
  return (
    "[GPGSIGN-HARDSTOP] The commit was NOT created — GPG signing failed because the secret key " +
    "is locked or unavailable. Only a human can unlock it (pinentry passphrase or smartcard)." +
    head +
    "\n" +
    "OBLIGATORY — DO NOT:\n" +
    "- inspect or modify gpg configuration (gpg.conf, gpg-agent.conf, ~/.gnupg, GPG_TTY)\n" +
    "- restart, kill, relaunch, or reload gpg-agent / gpgconf / gpg-connect-agent\n" +
    "- retry the commit/signing, force a passphrase, or use --pinentry-mode loopback\n" +
    "These actions are blocked and must not be attempted.\n\n" +
    "STOP the current task and ask the user to unlock their GPG key. Do not continue any " +
    "further work until the user confirms the key is unlocked and re-runs the commit."
  );
}

/**
 * Decide whether a bash tool result is a GPG signing failure requiring a hard
 * stop. Returns the replacement directive, or `undefined` to let the result
 * pass through untouched.
 */
export function gpgSignHardStop(command: string, output: string): string | undefined {
  if (!command) return undefined;
  // Only git commit and gpg operations can hit a signing failure.
  if (!/\bgit\s+commit\b|\bgpg\b/.test(command)) return undefined;
  const out = output ?? "";
  if (!isGpgSignFailure(out)) return undefined;
  return gpgHardStopDirective(out);
}
