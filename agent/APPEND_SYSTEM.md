Route every command execution and code edit through the harness tooling. Native equivalents are intercepted, blocked, or uncompressed — raw invocation loses structure-awareness, output compression, and guards, and silently routes around the policy layer.

- Long-running work (dev servers, watchers, test watch mode, background jobs): the `hub` tool (`op:"start"`), never nohup or trailing `&` — stays observable and addressable across turns; anything else is invisible to sibling sessions.
- Edits, file creation, and globs go through the lean-ctx MCP: one anchored `ctx_read` (`mode="anchored"`) then one `ctx_patch` (`op` `create` for new files) — re-anchor on drift instead of retrying blind `edit`/`write`; `ctx_glob` for in-repo globs. Native `write` only inside `./.tmp/` scratch.
- Writes belong in-repo (project files, `./.tmp/` scratch). Never write outside the project root via redirection, tee, or heredoc; never system directories.
- Reference, not replacement: details and enforcement in the `harness-tooling-discipline` rule and the config `bashInterceptor` patterns.
