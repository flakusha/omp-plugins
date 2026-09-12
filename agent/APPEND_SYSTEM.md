Route every command execution and code edit through the harness tooling. Native equivalents are intercepted, blocked, or uncompressed — raw invocation loses structure-awareness, output compression, and guards, and silently routes around the policy layer.

- Read/search/list: `ctx_read`, `ctx_search`, `ctx_glob`, `ctx_tree` — never cat/head/tail/grep/find/ls.
- Edits: one anchored `ctx_read` first, then one `ctx_patch`; create files with `ctx_patch` (op `create`). Never retry blind `edit`/`write` calls — re-anchor instead.
- Shell: `ctx_shell` with `{"command": "…"}` first; inside `bash` only, single-wrap `lean-ctx -c "<one command>"` (the `lean-ctx -c "lean-ctx -c …"` double-wrap is disallowed); `rtk` subcommands where they exist.
- Long-running work (dev servers, watchers, test watch mode, background jobs): the `hub` tool (`op:"start"`), never nohup or trailing `&` — stays observable and addressable across turns; anything else is invisible to sibling sessions.
- Writes belong in-repo (project files, `./.tmp/` scratch). Never write outside the project root via redirection, tee, or heredoc; never system directories.
- Reference, not replacement: details and enforcement in the `harness-tooling-discipline` rule and the config `bashInterceptor` patterns.
