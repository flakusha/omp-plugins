/**
 * Shared `/command` argument-completion plumbing.
 *
 * The TUI contract (`RegisteredCommand.getArgumentCompletions`) returns
 * `{ value, label }` items where `value` REPLACES the whole argument region —
 * already-completed tokens must be re-prefixed (builtin precedent, see the
 * `/mcp` completer) and a trailing space readies the cursor for the next
 * token. The per-command completions stay pure `string[]` producers so they
 * remain trivially testable; only this adapter knows the TUI item shape.
 *
 * NOTE: completions resolve paths via `process.cwd()`, not the session ctx —
 * `getArgumentCompletions` receives no context, so this assumes the TUI cwd
 * equals the process cwd. Revisit if the harness ever passes ctx here.
 */

/** Structural subset of the TUI `AutocompleteItem` the plugin needs. */
export interface ArgumentCompletionItem {
  value: string;
  label: string;
  description?: string;
}

/** Adapt raw suggestion strings to argument-region autocomplete items. */
export function argumentItems(
  argumentPrefix: string,
  suggestions: string[],
): ArgumentCompletionItem[] {
  const endsWithSpace = /\s$/.test(argumentPrefix);
  const all = argumentPrefix.trim().split(/\s+/).filter(Boolean);
  const complete = endsWithSpace ? all : all.slice(0, -1);
  const head = complete.join(" ");
  return suggestions.map((label) => ({
    value: head ? `${head} ${label} ` : `${label} `,
    label,
  }));
}
