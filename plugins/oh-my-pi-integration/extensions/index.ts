/**
 * Oh My Pi integration plugin — engram.
 *
 * Scope: `~/.omp` only. This extension:
 *  1. Auto-saves concise memories to engram on mutations and at turn/session
 *     end.
 *
 * Opt out entirely with env `PI_INTEGRATION_DISABLE=1`.
 *
 * 2. Turn-start retrieval: when `PI_INTEGRATION_RETRIEVE=1`, at the start of
 *    a turn the plugin searches engram for prior recorded memories for this
 *    project and injects a bounded context block into the agent loop, so the
 *    agent can reuse an already-recorded solution instead of re-deriving it.
 *    Retrieval is best-effort and bounded (timeout + length cap) — on any
 *    failure or timeout the turn proceeds normally with no injection. Set
 *    `PI_RETRIEVE_EVERY_TURN=1` to re-retrieve on every turn (default: once
 *    per session, where cross-session reuse matters most).
 *
 * 3. Receipt carriage: when `<project>/.omp/receipt.toml` exists, each turn
 *    carries the job ledger as an invisible footer message and applies the
 *    pruning chores (finished jobs dropped after 3 receipts). Fail-open;
 *    opt out with `PI_RECEIPT_DISABLE=1`.
 *
 * Feature wiring lives in ./plugin/* (guards, post-edit lint, memory buffer,
 * turn-start retrieval); this entry registers them plus the receipt carriage,
 * the /wt base placement, and the global slash commands.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { registerCommands } from "./commands/commands";
import { registerDestructiveGitNotice, registerGpgGuard, registerSshGuard } from "./plugin/guards";
import { registerMemoryBuffer } from "./plugin/memory-buffer";
import { registerPostEditLint } from "./plugin/post-edit-lint";
import { registerTurnStartRetrieval } from "./plugin/retrieval";
import { carryReceipt } from "./receipt/receipt";
import { createWorktreeBaseApplier } from "./util/worktree-base";

const DISABLE = () => typeof process !== "undefined" && process.env?.PI_INTEGRATION_DISABLE === "1";

export default function integrationPlugin(pi: ExtensionAPI): void {
  if (DISABLE()) return;

  registerGpgGuard(pi);
  registerSshGuard(pi);
  registerDestructiveGitNotice(pi);
  registerPostEditLint(pi);
  registerMemoryBuffer(pi);
  registerTurnStartRetrieval(pi);

  // ---- 9) receipt carriage: carry <cwd>/.omp/receipt.toml each turn -------
  // Injects the project's job ledger as an invisible footer message and runs
  // the pruning chores (see receipt/receipt.ts). Fail-open by construction;
  // opt out with PI_RECEIPT_DISABLE=1.
  pi.on("before_agent_start", async (_event, ctx: ExtensionContext) => {
    try {
      return await carryReceipt(ctx.cwd);
    } catch {
      return undefined; // receipt must never break the loop
    }
  });

  // ---- 11) /wt out-of-repo placement: OMP_WORKTREE_DIR → <repoParent>/<repo>-worktrees ----
  // The built-in /wt (dispatched before extension commands) resolves its base
  // from OMP_WORKTREE_DIR ?? worktree.base ?? <profileRoot>/wt; only the env
  // var accepts a per-repo path, so set it whenever the session cwd is inside
  // a git repo. The base is a sibling of the primary repo root — never inside
  // it (an in-repo container recursed: the /wt clone backend copies the full
  // working tree, so worktrees contained copies of prior worktrees).
  // Refreshed on session_start and on every submitted input so a
  // /move between repos re-points (or unsets) our own value. Fail-open.
  const applyWorktreeBase = createWorktreeBaseApplier();
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    try {
      applyWorktreeBase(ctx.cwd);
    } catch {
      /* placement must never break the loop */
    }
    return undefined;
  });
  pi.on("input", (_event, ctx: ExtensionContext) => {
    try {
      applyWorktreeBase(ctx.cwd);
    } catch {
      /* placement must never break the loop */
    }
    return undefined;
  });

  // ---- 10) global slash commands (/receipt, /verify, /recall) ----
  // Handlers close over `pi` (command ctx carries no AgentAPI); registered
  // at load so they resolve in every session of every profile.
  registerCommands(pi);

  pi.setLabel("engram");
}
