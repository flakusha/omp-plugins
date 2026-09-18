/**
 * `/finalize` — audit-first worktree finalization.
 *
 * Merges a worktree branch into the repo's default branch and removes the
 * worktree. The handler only detects the environment (fs checks, no turn
 * spent) and routes: `/finalize status` answers read-only via `notify`,
 * everything else builds a prompt for `pi.sendUserMessage` so the merge
 * itself runs inside an agent turn — with all guards active and a confirm
 * step before anything destructive. Commands never shell out a merge.
 *
 * giwt integration: when giwt is available (giwt.toml or .tmp/giwt present),
 * the prompt delegates to `giwt finalize` instead of manual git merge
 * commands. giwt's finalize handles merge-with-gates (check + test), lockfile
 * safety, GPG signing, stash/pop, ticket sync, and worktree cleanup. The
 * audit pre-checks (divergence, layout-violation, corruption) remain omp's
 * responsibility — they run in the prompt before the giwt call.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { resolveGiwtConfig } from "../util/giwt-config";
import { argumentItems } from "./completions";

export interface FinalizeEnv {
  /** Repo root (session cwd, or its ancestor above the worktree dir). */
  root: string;
  /** `scripts/worktree/` CLI (or legacy `scripts/worktree.sh`) present. */
  worktreeCli: boolean;
  /** Existing worktree container dir name, if any. */
  worktreeDir: string | null;
  /** Session cwd is inside a worktree checkout. */
  inWorktree: boolean;
  /** Worktree dir basename when inside one (branch guess). */
  branchGuess: string | null;
  /** giwt available (giwt.toml or .tmp/giwt present). */
  giwtAvailable: boolean;
  /** Planning index present (.plan/ dir) — gates `--plan-gates` on giwt finalize. */
  planIndex: boolean;
}

const WORKTREE_DIRS = ["tree", ".worktrees"];

/** Index of the worktree container segment in a split path, or -1. */
function findWorktreeAnchor(parts: string[]): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "tree" || parts[i] === ".worktrees") return i;
  }
  return -1;
}

function hasWorktreeCli(root: string): boolean {
  return (
    existsSync(join(root, "scripts/worktree/index.ts")) ||
    existsSync(join(root, "scripts/worktree/index.mjs")) ||
    existsSync(join(root, "scripts/worktree.sh"))
  );
}

function existingWorktreeDir(root: string): string | null {
  for (const candidate of WORKTREE_DIRS) {
    if (existsSync(join(root, candidate))) return candidate;
  }
  return null;
}

/** Pure fs detection of the worktree environment for a session cwd. */
export function detectFinalizeEnv(cwd: string | undefined): FinalizeEnv {
  const here = cwd ?? process.cwd();
  const parts = here.split("/").filter(Boolean);
  const at = findWorktreeAnchor(parts);
  const inWorktree = at >= 0 && at < parts.length - 1;
  const root = inWorktree ? `/${parts.slice(0, at).join("/")}` : here;
  const worktreeDir = inWorktree ? (parts[at] ?? null) : existingWorktreeDir(root);
  const branchGuess = inWorktree ? (parts[parts.length - 1] ?? null) : null;
  const giwtConfig = resolveGiwtConfig(root);
  return {
    root,
    worktreeCli: hasWorktreeCli(root),
    worktreeDir,
    inWorktree,
    branchGuess,
    giwtAvailable: giwtConfig.available,
    planIndex: existsSync(join(root, ".plan")),
  };
}

/**
 * Sync fs listing of existing worktree names (container dir entries).
 * Pure reads only — never throws; returns [] when no container exists.
 */
export function existingWorktreeNames(cwd: string | undefined): string[] {
  const env = detectFinalizeEnv(cwd);
  if (!env.worktreeDir) return [];
  try {
    return readdirSync(join(env.root, env.worktreeDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Tab completion for `/finalize …`: `status` plus existing worktree names
 * (the branch argument). Later tokens are not enumerable.
 */
export function finalizeCompletions(argPrefix: string, cwd: string | undefined): string[] {
  const tokens = argPrefix.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1) return [];
  const partial =
    tokens.length === 1 && !/\s$/.test(argPrefix) ? (tokens[0] ?? "").toLowerCase() : "";
  return ["status", ...existingWorktreeNames(cwd)].filter((v) => v.startsWith(partial));
}

/** Build the turn prompt that performs the audited finalize. */
export function buildFinalizePrompt(env: FinalizeEnv, branch: string): string {
  const mergeStep = env.worktreeCli
    ? `Prefer the repo worktree CLI from the repo root: bun run scripts/worktree/ finalize ${branch}. Run it from ${env.root} with REPO_ROOT=${env.root} in the environment — the finalize script mis-detects the default branch when run from inside a worktree (0-ahead false negative), so never run it from inside the worktree without REPO_ROOT set.`
    : `No worktree CLI detected in ${env.root}: merge with plain git from the repo root — git merge refs/heads/${branch} --no-edit, then git worktree remove <path> --force + git branch -d ${branch}.`;
  return [
    `Finalize the worktree for branch '${branch}': merge it into the default branch and remove the worktree.`,
    `Detected environment: repo root ${env.root}; worktree CLI ${env.worktreeCli ? "present" : "absent"}; worktree dir ${env.worktreeDir ?? "none"}; invoked inside worktree ${env.inWorktree ? "yes" : "no"}.`,
    "Procedure, in order — stop and report on any red verdict:",
    "1. Resolve the default branch (dev preferred; else the remote default via git symbolic-ref refs/remotes/origin/HEAD). The branch to finalize must not be the default branch itself.",
    "2. Require a clean tree: git status --short in the worktree must be empty. Dirty means mid-work — stop, do not merge.",
    "3. Audit before merge (a clean tree is necessary but not sufficient): divergence via git merge-base <base> <branch> with ahead (base..branch) and behind counts — already fully merged means skip the merge and only remove the worktree + delete the branch; a large behind count with the branch's changes already present on base means orphaned/redundant — remove without merging; added files at layout-violating paths (git diff <base>..<branch> --name-status, lines starting with 'A') mean a corrupted branch — do NOT merge, remove without merging and report.",
    `4. Merge: ${mergeStep} Fallbacks if the CLI fails: retry with REPO_ROOT set; then the manual refs/heads merge from ${env.root} (unstage with git reset HEAD -- . if stale stash/worktree state blocks it); --no-verify only if a format hook blocks an otherwise-good merge commit.`,
    "5. After merging: confirm the merge commit exists on the base, then remove the worktree and delete the branch; verify with git worktree list + git log --oneline -3. If the repo has a planning index (.plan/ + plan:sync script), run the sync check.",
    "6. Confirm with the user before the merge step and before any branch/worktree deletion — use the ask tool (options: proceed / abort), never a turn-yielding chat question; on any red verdict, report it via the ask tool instead of ending the turn. Report the final verdict: merged, removed-as-redundant, removed-as-corrupted, or blocked-dirty.",
  ].join("\n");
}

/**
 * Build the turn prompt for giwt-delegated finalize. Keeps omp's audit
 * pre-checks (divergence, layout-violation, corruption) but replaces the
 * manual merge procedure with `giwt finalize`, which handles merge-with-gates,
 * lockfile safety, GPG signing, stash/pop, ticket sync, and worktree cleanup.
 */
export function buildGiwtFinalizePrompt(env: FinalizeEnv, branch: string): string {
  return [
    `Finalize the worktree for branch '${branch}' using giwt.`,
    `Detected environment: repo root ${env.root}; giwt available; worktree dir ${env.worktreeDir ?? "none"}; invoked inside worktree ${env.inWorktree ? "yes" : "no"}.`,
    "Procedure, in order — stop and report on any red verdict:",
    "1. Resolve the default branch (dev preferred; else the remote default via git symbolic-ref refs/remotes/origin/HEAD). The branch to finalize must not be the default branch itself.",
    "2. Require a clean tree: git status --short in the worktree must be empty. Dirty means mid-work — stop, do not merge.",
    "3. Audit before merge (a clean tree is necessary but not sufficient): divergence via git merge-base <base> <branch> with ahead (base..branch) and behind counts — already fully merged means skip the merge and only remove the worktree + delete the branch; a large behind count with the branch's changes already present on base means orphaned/redundant — remove without merging; added files at layout-violating paths (git diff <base>..<branch> --name-status, lines starting with 'A') mean a corrupted branch — do NOT merge, remove without merging and report.",
    `4. Merge: run \`bun run giwt finalize ${branch}${env.planIndex ? " --plan-gates all" : ""}\` from ${env.root} with REPO_ROOT=${env.root} in the environment. giwt handles:`,
    "   - Merge-with-gates: runs `commands.check` + `commands.test` from giwt.toml before merging",
    "   - Lockfile safety (.worktree-finalize.lock) for signal-safe cleanup (SIGINT/SIGTERM/SIGHUP)",
    "   - GPG signing verification (asserts agent key unlocked before merging)",
    "   - Stash/pop for dirty worktrees",
    "   - Ticket index sync after merge (.plan/tickets/ ↔ index.json)",
    env.planIndex
      ? "   - Plan validation gate (--plan-gates all): validates the .plan index, epics, and ticket links before merging"
      : "   - No plan gate: repo has no .plan planning index",
    "   - Worktree removal + branch deletion",
    "   Fallbacks if giwt fails: retry with REPO_ROOT set; then manual git merge from " +
      env.root +
      " (git merge refs/heads/" +
      branch +
      " --no-edit + git worktree remove <path> + git branch -d " +
      branch +
      ").",
    "5. After merging: verify with git worktree list + git log --oneline -3. If the repo has a planning index (.plan/ + plan:sync script), run the sync check.",
    "6. Confirm with the user before the merge step and before any branch/worktree deletion — use the ask tool (options: proceed / abort), never a turn-yielding chat question; on any red verdict, report it via the ask tool instead of ending the turn. Report the final verdict: merged, removed-as-redundant, removed-as-corrupted, or blocked-dirty.",
  ].join("\n");
}

async function showFinalizeStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const res = await pi.exec("git", ["worktree", "list"], { timeout: 15000 });
    const out = (res.stdout ?? "").trim();
    ctx.ui.notify(out ? `worktrees:\n${out}` : "no linked worktrees", "info");
  } catch {
    ctx.ui.notify("git worktree list failed (not a git repo?)", "warning");
  }
}

/** Register `/finalize` on the plugin factory's `pi`. */
export function registerFinalize(pi: ExtensionAPI): void {
  pi.registerCommand("finalize", {
    description: "Audit, merge and remove a worktree branch; `/finalize status` lists worktrees",
    // NOTE: process.cwd() because getArgumentCompletions gets no ctx — assumes TUI cwd == process cwd (see completions.ts).
    getArgumentCompletions: (argumentPrefix: string) =>
      argumentItems(argumentPrefix, finalizeCompletions(argumentPrefix, process.cwd())),
    handler: async (args, ctx) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      if (argv[0] === "status") {
        await showFinalizeStatus(pi, ctx);
        return;
      }
      if (argv.length > 1) {
        ctx.ui.notify("usage: /finalize [<branch>|status]", "error");
        return;
      }
      const env = detectFinalizeEnv(ctx.cwd);
      const branch = argv[0] ?? env.branchGuess;
      if (!branch) {
        ctx.ui.notify(
          "usage: /finalize [<branch>|status] — no branch given and not inside a worktree",
          "error",
        );
        return;
      }
      // Delegate to giwt finalize when available; fall back to manual prompt.
      const prompt = env.giwtAvailable
        ? buildGiwtFinalizePrompt(env, branch)
        : buildFinalizePrompt(env, branch);
      await pi.sendUserMessage(prompt);
    },
  });
}
