// Git destructive-work soft guard.
//
// Stop-gap for rule `no-git-stash-shared-branch`: agents habitually stash,
// hard-reset, force-checkout, or force-push uncommitted work to "clear the
// way", which silently moves or destroys it. This guard is SOFT: it does not
// block (legitimate destructive git exists), but surfaces the loss risk to
// the user every time a destructive git command succeeds, so the agent stops
// and verifies intent instead of marching on.
//
// House pattern (mirrors gpg/ssh guards): pure predicate + hard-coded
// reason, wired in extensions/index.ts, unit-tested in __tests__/.

/**
 * Git subcommands that move or destroy uncommitted/local work.
 * `stash` (create) and `stash drop` destroy stashed work; `stash pop/apply`
 * restore it and are safe. `reset --hard`, `clean -f`, `checkout -f`,
 * `checkout -- <path>` discard working-tree/commit work. `push -f` rewrites
 * remote history. `branch -D` deletes an unmerged branch.
 */
const DESTRUCTIVE_RE =
  /\bgit(?:\s+-C\s+\S+)?\s+(?:stash\b(?!\s+(?:pop|apply))|reset\s+--hard\b|clean\s+-f|checkout\s+-f(?!\w)|checkout\s+--(?!\w)|push\s+(?:-f|--force)\b|branch\s+-D\b)/;

export function isDestructiveGitCommand(cmd: string): boolean {
  if (!cmd || cmd.startsWith("#")) return false;
  return DESTRUCTIVE_RE.test(cmd);
}

export const GIT_DESTRUCTIVE_NOTICE =
  "[GIT-DESTRUCTIVE] That git command moved or destroyed uncommitted work " +
  "(stash/hard-reset/force-checkout/force-push/branch -D). Verify nothing was " +
  "lost and the intent is real; if this was a mistake, stop and ask the user to restore.";
