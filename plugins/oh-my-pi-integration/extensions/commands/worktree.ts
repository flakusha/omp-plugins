/**
 * `/worktree` — create an in-repo worktree and start working in it.
 *
 * `/worktree <name> <task...>` creates `<container>/<name>/` (new branch
 * `<name>`, based on HEAD) via `git worktree add -b` and starts an agent
 * turn scoped to that checkout. The container reuses the repo's existing
 * convention (`tree/` or `.worktrees/`), defaulting to `tree/`.
 *
 * giwt integration: when giwt is available, creation delegates to
 * `giwt new-branch <name>` which adds branch protection checks, GPG signing
 * config, `.credentials.env` symlink, and `node_modules` linking. Falls back
 * to `git worktree add -b` when giwt is unavailable.
 *
 * Handler discipline: creation is the command's explicit purpose, so the
 * `git worktree add` runs in the handler via `pi.exec`; a creation failure
 * notifies and stops with no turn spent. The task itself always runs inside
 * an agent turn — the handler never does the work.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { resolveGiwtConfig } from "../util/giwt-config";
import { argumentItems } from "./completions";
import { detectFinalizeEnv, existingWorktreeNames } from "./finalize";

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

/**
 * Create a worktree. Tries giwt's `new-branch` command first (adds branch
 * protection, GPG config, credentials symlink, node_modules link), falls
 * back to `git worktree add -b` when giwt is unavailable.
 *
 * TREE_DIR env is set to align giwt's worktree container with omp's
 * OMP_WORKTREE_DIR when the latter is set — so giwt places worktrees
 * in the same out-of-repo sibling dir omp uses.
 */
async function createWorktree(pi: ExtensionAPI, target: WorktreeTarget): Promise<string | null> {
  const giwtConfig = resolveGiwtConfig(target.root);

  // Try giwt new-branch when available
  if (giwtConfig.available) {
    try {
      // Align TREE_DIR with OMP_WORKTREE_DIR when set
      const savedTreeDir = process.env.TREE_DIR;
      const savedRepoRoot = process.env.REPO_ROOT;
      if (process.env.OMP_WORKTREE_DIR) process.env.TREE_DIR = process.env.OMP_WORKTREE_DIR;
      process.env.REPO_ROOT = target.root;
      try {
        await pi.exec("giwt", ["new-branch", target.name], { timeout: 60000 });
        return null; // giwt succeeded
      } finally {
        // Restore env
        process.env.TREE_DIR = savedTreeDir;
        process.env.REPO_ROOT = savedRepoRoot;
      }
    } catch {
      // giwt failed — fall through to git worktree add
    }
  }

  // Fallback: git worktree add -b
  mkdirSync(join(target.root, target.container), { recursive: true });
  try {
    await pi.exec("git", ["worktree", "add", "-b", target.name, target.path], { timeout: 60000 });
    return null;
  } catch {
    return `could not create worktree '${target.name}' (branch may already exist)`;
  }
}

/**
 * Tab completion for `/worktree …`: the first token only — existing worktree
 * names. The task text is free-form and not enumerable.
 */
export function worktreeCompletions(argPrefix: string, cwd: string | undefined): string[] {
  const tokens = argPrefix.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1) return [];
  const partial =
    tokens.length === 1 && !/\s$/.test(argPrefix) ? (tokens[0] ?? "").toLowerCase() : "";
  return existingWorktreeNames(cwd).filter((n) => n.toLowerCase().startsWith(partial));
}

/** Register `/worktree` on the plugin factory's `pi`. */
export function registerWorktree(pi: ExtensionAPI): void {
  pi.registerCommand("worktree", {
    description: "Create `tree/<name>/` and work on a task there: `/worktree <name> <task...>`",
    // NOTE: process.cwd() because getArgumentCompletions gets no ctx — assumes TUI cwd == process cwd (see completions.ts).
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(argumentPrefix, worktreeCompletions(argumentPrefix, process.cwd())),
    handler: async (args, ctx) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const name = argv[0];
      const task = argv.slice(1).join(" ");
      if (!name) {
        // Bare `/worktree` answers read-only: list existing checkouts.
        const names = existingWorktreeNames(ctx.cwd);
        ctx.ui.notify(
          names.length
            ? `existing worktrees:\n${names.map((n) => `  ${n}`).join("\n")}\nusage: /worktree <name> <task...>`
            : "usage: /worktree <name> <task...>",
          "info",
        );
        return;
      }
      if (!task) {
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
