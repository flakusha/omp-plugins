/**
 * tool_call / tool_result safety guards registered on the plugin factory's
 * `pi`: GPG signing hard-stop, SSH agent-socket hard-stop, and the
 * destructive-git loss-risk notice. Pure predicates live in ../guards/.
 */

import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { GIT_DESTRUCTIVE_NOTICE, isDestructiveGitCommand } from "../guards/git-destructive-guard";
import { GPG_BLOCK_REASON, gpgSignHardStop, isGpgTamperCommand } from "../guards/gpg-guard";
import { isSshTamperCommand, SSH_BLOCK_REASON, sshSockHardStop } from "../guards/ssh-guard";

/** Register the GPG signing hard-stop guard (block + rewrite failed sign results). */
export function registerGpgGuard(pi: ExtensionAPI): void {
  // ---- 4) GPG signing hard-stop guard ----
  // Agents habitually try to "discover gpg config" / restart gpg-agent after a
  // signing failure instead of stopping. A locked secret key only a HUMAN can
  // unlock, so: (a) substitute an imperative hard-stop directive for the raw
  // signing error the model would otherwise read, and (b) block gpg-agent
  // lifecycle / passphrase-bypass commands outright.
  let gpgNotified = false;
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const { command } = event.input;
    if (!command || command.startsWith("#")) return;
    if (!isGpgTamperCommand(command)) return;
    return { block: true, reason: GPG_BLOCK_REASON };
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "bash" || !event.isError) return;
    const command = String(event.input?.command ?? "");
    const output = event.content
      .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text ?? "") : ""))
      .join("\n");
    const directive = gpgSignHardStop(command, output);
    if (!directive) return;
    if (!gpgNotified) {
      gpgNotified = true;
      ctx.ui.notify?.(
        "GPG signing failed — secret key locked. Unlock it (pinentry/smartcard); agent has stopped.",
        "error",
      );
    }
    return { content: [{ type: "text", text: directive }], isError: true };
  });
}

/** Register the SSH agent socket hard-stop guard (block + rewrite failures). */
export function registerSshGuard(pi: ExtensionAPI): void {
  // ---- 5) SSH agent socket hard-stop guard ----
  // Agents habitually try to "fix" an ssh-agent socket failure by killing
  // ssh-agent, removing the socket, or starting a new agent — which silently
  // switches to a socket whose keys aren't loaded. A missing/stale agent
  // socket needs a HUMAN to restore. (a) substitute a hard-stop directive for
  // the raw SSH error, and (b) block ssh-agent socket/process tampering.
  let sshNotified = false;
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const { command } = event.input;
    if (!command || command.startsWith("#")) return;
    if (!isSshTamperCommand(command)) return;
    return { block: true, reason: SSH_BLOCK_REASON };
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "bash" || !event.isError) return;
    const command = String(event.input?.command ?? "");
    const output = event.content
      .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text ?? "") : ""))
      .join("\n");
    const directive = sshSockHardStop(command, output);
    if (!directive) return;
    if (!sshNotified) {
      sshNotified = true;
      ctx.ui.notify?.(
        "SSH agent/socket failure — ssh-agent missing or stale. Restore it; agent has stopped.",
        "error",
      );
    }
    return { content: [{ type: "text", text: directive }], isError: true };
  });
}

/** Register the destructive-git soft guard: surfaces loss risk, never blocks. */
export function registerDestructiveGitNotice(pi: ExtensionAPI): void {
  // ---- 6) destructive-git soft guard ----
  // Agents habitually stash / hard-reset / force-checkout uncommitted work to
  // "clear the way". This guard does NOT block (legitimate destructive git
  // exists) — it surfaces the loss risk to the user every time a destructive
  // git command succeeds, so the agent stops and verifies intent.
  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "bash" || event.isError) return;
    const command = String(event.input?.command ?? "");
    if (!isDestructiveGitCommand(command)) return;
    ctx.ui.notify?.(GIT_DESTRUCTIVE_NOTICE, "warning");
  });
}
