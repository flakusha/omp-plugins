/** Environment detection for `/bookkeep`: fs-only checks, no turn spent. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveGiwtConfig } from "../../util/giwt-config";

export interface BookkeepEnv {
  /** Session cwd (repo root guess). */
  root: string;
  /** `.plan/` planning dir present. */
  planDir: boolean;
  /** `plan:*` index scripts present in package.json. */
  planScripts: string[];
  /** `scripts/worktree/{ticket,issues,prs,gi}` tracker CLI present. */
  worktreeTracker: boolean;
  /** `gh` on PATH. */
  gh: boolean;
  /** `jira` on PATH. */
  jira: boolean;
  /** giwt available (giwt.toml or .tmp/giwt dir present). */
  giwtAvailable: boolean;
}

const PLAN_SCRIPTS = ["plan:sync", "plan:find", "plan:map", "plan:docs"];
const TRACKER_COMMANDS = ["ticket", "issues", "prs", "gi"];

export function onPath(bin: string, pathEnv?: string): boolean {
  const path = pathEnv ?? process.env.PATH ?? "";
  return path.split(":").some((dir) => {
    try {
      return existsSync(join(dir, bin));
    } catch {
      return false;
    }
  });
}

function planScriptsOf(root: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return PLAN_SCRIPTS.filter((s) => typeof pkg.scripts?.[s] === "string");
  } catch {
    return [];
  }
}

/** Pure detection of the issue-tracking environment for a session cwd. */
export function detectBookkeepEnv(cwd: string | undefined): BookkeepEnv {
  const root = cwd ?? process.cwd();
  const worktreeTracker = TRACKER_COMMANDS.some(
    (cmd) =>
      existsSync(join(root, `scripts/worktree/${cmd}.ts`)) ||
      existsSync(join(root, `scripts/worktree/${cmd}.mjs`)),
  );
  const giwtConfig = resolveGiwtConfig(root);
  return {
    root,
    planDir: existsSync(giwtConfig.planDir),
    planScripts: planScriptsOf(root),
    worktreeTracker,
    gh: onPath("gh"),
    jira: onPath("jira"),
    giwtAvailable: giwtConfig.available,
  };
}
