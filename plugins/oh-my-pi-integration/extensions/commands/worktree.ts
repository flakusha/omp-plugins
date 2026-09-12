/**
 * `/worktree` — create an in-repo worktree and start working in it.
 *
 * `/worktree <name> <task...>` creates `<container>/<name>/` (new branch
 * `<name>`, based on HEAD) via `git worktree add -b` and starts an agent
 * turn scoped to that checkout. The container reuses the repo's existing
 * convention (`tree/` or `.worktrees/`), defaulting to `tree/`.
 *
 * Handler discipline: creation is the command's explicit purpose, so the
 * `git worktree add` runs in the handler via `pi.exec`; a creation failure
 * notifies and stops with no turn spent. The task itself always runs inside
 * an agent turn — the handler never does the work.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { detectFinalizeEnv } from "./finalize";

export interface WorktreeTarget {
  /** Repo root the worktree belongs to. */
  root: string;
  /** Container dir name (`tree` or `.worktrees`). */
  container: string;
  /** Worktree/branch name. */
  name: string;
  /** Absolute path of the checkout. */
  path: string;
  /** Checkout already existed (reuse, no creation). */
  existed: boolean;
}

/** Worktree names become branch names: flat, no slashes or traversal. */
export function validateWorktreeName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/** Resolve the checkout target for a session cwd and worktree name. */
export function resolveWorktreeTarget(cwd: string | undefined, name: string): WorktreeTarget {
  const env = detectFinalizeEnv(cwd);
  const container = env.worktreeDir ?? "tree";
  const path = join(env.root, container, name);
  return { root: env.root, container, name, path, existed: existsSync(path) };
}

/** Build the turn prompt that performs the task inside the checkout. */
export function buildWorktreePrompt(
  target: WorktreeTarget,
  task: string,
  created: boolean,
): string {
  const rel = relative(target.root, target.path);
  return [
    `Work in ${rel}/ (git worktree, branch '${target.name}'${created ? ", just created" : ", already existed and was reused"}) on: ${task}.`,
    `Scope all file reads/writes and commands to ${rel}/ — the repo root ${target.root} is reference only, do not modify files outside the checkout.`,
    "Follow the repo's own conventions found inside the checkout (verify gate, commit style). When the task is done, stop: do not merge or delete the worktree — /finalize handles that.",
  ].join("\n");
}

async function createWorktree(pi: ExtensionAPI, target: WorktreeTarget): Promise<string | null> {
  mkdirSync(join(target.root, target.container), { recursive: true });
  try {
    await pi.exec("git", ["worktree", "add", "-b", target.name, target.path], { timeout: 60000 });
    return null;
  } catch {
    return `could not create worktree '${target.name}' (branch may already exist)`;
  }
}

/** Register `/worktree` on the plugin factory's `pi`. */
export function registerWorktree(pi: ExtensionAPI): void {
  pi.registerCommand("worktree", {
    description: "Create `tree/<name>/` and work on a task there: `/worktree <name> <task...>`",
    handler: async (args, ctx) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const name = argv[0];
      const task = argv.slice(1).join(" ");
      if (!name || !task) {
        ctx.ui.notify("usage: /worktree <name> <task...>", "error");
        return;
      }
      if (!validateWorktreeName(name)) {
        ctx.ui.notify(
          "worktree names must match [A-Za-z0-9._-] (no slashes or traversal)",
          "error",
        );
        return;
      }
      const target = resolveWorktreeTarget(ctx.cwd, name);
      if (!target.existed) {
        const failure = await createWorktree(pi, target);
        if (failure) {
          ctx.ui.notify(failure, "error");
          return;
        }
      }
      await pi.sendUserMessage(buildWorktreePrompt(target, task, !target.existed));
    },
  });
}
