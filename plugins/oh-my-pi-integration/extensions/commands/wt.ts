/**
 * `/wt` — worktrunk bridge for git worktree lifecycle.
 *
 * Decision (2026-09-12): wrap, don't fork. Worktrunk (MIT/Apache-2.0,
 * max-sixty/worktrunk) owns switch/list/merge/remove path templating, hooks,
 * aliases, and copy-ignored reflink; the repo's own tracker
 * (scripts/worktree + git-issue + .plan) owns ticketing, GPG-signed commits,
 * and lock/signal-safe finalize with check gates — which worktrunk has no
 * equivalent for. So `/wt` delegates lifecycle to `wt` when it is on PATH
 * and always routes ticket flows to the repo tracker. No new binary dep:
 * `wt` absent means the prompt falls back to the existing CLI/git paths.
 *
 * Handler discipline (same as the other commands): bare/status answers go
 * to `ctx.ui.notify` (no turn spent); everything else builds a prompt for
 * `pi.sendUserMessage` so the work runs inside a turn with guards active.
 * The handler never shells out a merge, remove, or ticket create.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { onPath } from "./bookkeep";

export interface WtEnv {
  /** Session cwd (repo root guess). */
  root: string;
  /** `wt` (or Windows `git-wt`) on PATH. */
  wtOnPath: boolean;
  /** `.config/wt.toml` project hooks present. */
  wtToml: boolean;
  /** `scripts/worktree/` tracker CLI present. */
  worktreeCli: boolean;
  /** `.plan/` planning dir present. */
  planDir: boolean;
  /** `git-issue` on PATH. */
  gitIssue: boolean;
}

/**
 * Project hooks template written by `/wt init`. Encodes the repo's own
 * conventions as worktrunk config: worktrees under `tree/`, ignored-cache
 * sharing on create, check gate before merge, and aliases bridging the
 * tracker worktrunk deliberately has no equivalent for (ticket/sync).
 */
export const WT_TOML_TEMPLATE = `# worktrunk project config — lifecycle via wt, tracking via the repo CLI.
# Managed by /wt init; worktrunk approves project commands on first run.
worktree-path = "tree/{{ branch | sanitize }}"

[post-start]
caches = "wt step copy-ignored"

[pre-merge]
check = "bun run check"

[aliases]
ticket = "bun run scripts/worktree/ ticket {{ args }}"
sync = "bun run scripts/worktree/ sync {{ args }}"
finalize = "bun run scripts/worktree/ finalize {{ args }}"
`;

/** Tracker subcommands owned by the repo CLI — never delegated to wt. */
const TRACKER: Record<string, true> = {
  ticket: true,
  sync: true,
  gi: true,
  issues: true,
  search: true,
  show: true,
  comment: true,
  attach: true,
  state: true,
  edit: true,
  prs: true,
  report: true,
};

/** Pure detection of the worktrunk environment for a session cwd. */
export function detectWtEnv(cwd: string | undefined, pathEnv?: string): WtEnv {
  const root = cwd ?? process.cwd();
  return {
    root,
    wtOnPath: onPath("wt", pathEnv) || onPath("git-wt", pathEnv),
    wtToml: existsSync(join(root, ".config", "wt.toml")),
    worktreeCli:
      existsSync(join(root, "scripts", "worktree", "index.ts")) ||
      existsSync(join(root, "scripts", "worktree", "index.mjs")),
    planDir: existsSync(join(root, ".plan")),
    gitIssue: onPath("git-issue", pathEnv),
  };
}

function envLine(env: WtEnv): string {
  const yesNo = (v: boolean): string => (v ? "yes" : "no");
  return (
    `repo root ${env.root}; wt on PATH ${yesNo(env.wtOnPath)}; ` +
    `.config/wt.toml ${yesNo(env.wtToml)}; worktree CLI ${yesNo(env.worktreeCli)}; ` +
    `.plan ${yesNo(env.planDir)}; git-issue ${yesNo(env.gitIssue)}`
  );
}

/** Read-only summary for bare `/wt` and `/wt status` (notify, no turn). */
export function buildWtStatus(env: WtEnv): string {
  const lines = [
    `wt: ${env.wtOnPath ? "available" : "not on PATH (lifecycle falls back to git/scripts/worktree)"}`,
    `project hooks: ${env.wtToml ? ".config/wt.toml present" : "absent — /wt init writes the template"}`,
    `tracker: ${env.worktreeCli ? "scripts/worktree present" : "absent"}${
      env.planDir ? " + .plan" : ""
    }${env.gitIssue ? " + git-issue" : ""}`,
    "usage: /wt <switch|list|merge|remove|...|ticket|sync|init|status>",
  ];
  return lines.join("\n");
}

/**
 * Build the turn prompt for a doing-thing `/wt` invocation.
 * Pure — all fs/PATH facts come from `env`.
 */
export function buildWtPrompt(env: WtEnv, sub: string, rest: string): string {
  const arg = rest.trim();
  if (sub === "init") {
    return [
      `Set up worktrunk project hooks in ${env.root}: write .config/wt.toml with this content, adjusting only the pre-merge check command to the repo's own verify gate when it is not \`bun run check\`:`,
      "```toml",
      WT_TOML_TEMPLATE.trimEnd(),
      "```",
      `Detected environment: ${envLine(env)}. Run \`wt config shell install\` first when wt is newly installed so switch changes directories.`,
    ].join("\n");
  }
  if (TRACKER[sub] === true) {
    // === true: Record lookup must not match Object.prototype (e.g. /wt constructor)
    const cli = env.worktreeCli ? `bun run scripts/worktree/ ${sub}${arg ? ` ${arg}` : ""}` : null;
    return [
      `Tracker operation '${sub}' belongs to the repo CLI, not worktrunk (worktrunk has no ticket/issue concept).`,
      `Detected environment: ${envLine(env)}.`,
      cli
        ? `Run from ${env.root}: ${cli}. Cross-reference the git issue with its .plan/tickets/ file (see /bookkeep), and /find-work to discover items.`
        : `No scripts/worktree CLI in ${env.root}: use git-issue directly${arg ? ` (${arg})` : ""} and keep any .plan/tickets/ file in sync by hand.`,
    ].join("\n");
  }
  if (env.wtOnPath) {
    return [
      `Run worktrunk lifecycle '${sub}${arg ? ` ${arg}` : ""}' from ${env.root}: \`wt ${sub}${
        arg ? ` ${arg}` : ""
      }\`.`,
      `Detected environment: ${envLine(env)}.`,
      env.wtToml
        ? "Project hooks in .config/wt.toml run automatically (approve on first run); --yes only for automation, --no-hooks only to isolate a hook failure."
        : "No .config/wt.toml yet — /wt init writes the template (post-start cache sharing, pre-merge check gate, ticket/sync aliases).",
      "Ticketing stays on the repo tracker (/bookkeep, /find-work); GPG-sign commits per repo convention and finalize through the repo's audited path (/finalize) rather than wt merge when check gates must run.",
    ].join("\n");
  }
  const fallback =
    "wt is not on PATH (brew install worktrunk / cargo install worktrunk): use plain git worktree commands from the repo root — git worktree add -b <branch> tree/<branch>, git worktree list, git worktree remove <path> — or the repo CLI when present (bun run scripts/worktree/ new|list|remove).";
  return [
    `Worktrunk lifecycle '${sub}' requested but wt is not installed.`,
    `Detected environment: ${envLine(env)}.`,
    fallback,
    "Tracker operations still go through the repo CLI (/bookkeep, /find-work); do not invent ticket state in worktrunk vars.",
  ].join("\n");
}

/** Register `/wt` on the plugin factory's `pi`. */
export function registerWt(pi: ExtensionAPI): void {
  pi.registerCommand("wt", {
    description: "Worktrunk bridge: /wt <switch|list|merge|remove|ticket|sync|init|status>",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const env = detectWtEnv(ctx.cwd);
      if (argv.length === 0 || argv[0] === "status") {
        ctx.ui.notify(buildWtStatus(env), "info");
        return;
      }
      const [sub, ...rest] = argv as [string, ...string[]];
      await pi.sendUserMessage(buildWtPrompt(env, sub, rest.join(" ")));
    },
  });
}
