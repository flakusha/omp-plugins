/** Subcommand dispatch for `/bookkeep`: argv → prompt or notify message. */

import { dumpGiwtConfig } from "../../util/giwt-config";
import type { BookkeepEnv } from "./env";
import {
  bookkeepUsage,
  buildAuditPrompt,
  buildFindPrompt,
  buildIssuePrompt,
  buildListPrompt,
  buildSyncPrompt,
} from "./prompts";

export type BookkeepAction = { prompt: string } | { message: string; level: "info" | "error" };

function auditAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  if (!rest[0]) return { message: "usage: /bookkeep audit <epic|ticket>", level: "error" };
  return { prompt: buildAuditPrompt(env, rest[0]) };
}

function syncAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  return { prompt: buildSyncPrompt(env, rest.includes("--fix")) };
}

function findAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  if (rest.length === 0) return { message: "usage: /bookkeep find <query>", level: "error" };
  return { prompt: buildFindPrompt(env, rest.join(" ")) };
}

function issueAction(env: BookkeepEnv, rest: string[]): BookkeepAction {
  if (rest.length === 0) return { message: "usage: /bookkeep issue <request>", level: "error" };
  return { prompt: buildIssuePrompt(env, rest.join(" ")) };
}

/** Read-only config dump: resolved giwt paths, branches, commands. */
function configAction(env: BookkeepEnv): BookkeepAction {
  return { message: `${bookkeepUsage(env)}\n\n${dumpGiwtConfig(env.root)}`, level: "info" };
}

const BOOKKEEP_ACTIONS: Record<string, (env: BookkeepEnv, rest: string[]) => BookkeepAction> = {
  audit: auditAction,
  sync: syncAction,
  find: findAction,
  issue: issueAction,
  list: (env: BookkeepEnv) => ({ prompt: buildListPrompt(env) }),
  config: (env: BookkeepEnv) => configAction(env),
};

export function resolveBookkeepAction(env: BookkeepEnv, argv: string[]): BookkeepAction {
  const sub = argv[0];
  if (sub === undefined) return { message: bookkeepUsage(env), level: "info" };
  const run = BOOKKEEP_ACTIONS[sub];
  if (!run)
    return { message: `unknown subcommand '${sub}'. ${bookkeepUsage(env)}`, level: "error" };
  return run(env, argv.slice(1));
}
