Route every command execution and code edit through the harness tooling — raw invocation loses structure-awareness, output compression, and guards.

- Long-running processes (servers, watchers, watch-mode tests, background jobs): the `hub` tool (`op:"start"`), never nohup or trailing `&` — anything else is invisible to sibling sessions.
- Edits, file creation, and globs via lean-ctx MCP: one anchored `ctx_read` (`mode="anchored"`), then `ctx_patch` (`op` `create` for new files; re-anchor on drift); `ctx_glob` for in-repo globs. Native `write` only inside `./.tmp/` scratch.
- The `eval` tool is disabled: write a re-executable `./.tmp/` script and run it via bash (`python .tmp/x.py`, `bun .tmp/x.ts`) — never `python -c`/`node -e`/heredoc-to-interpreter (guard-blocked).
- Never write outside the project root via redirection, tee, or heredoc; never system directories.
- Details and enforcement: the `harness-tooling-discipline` rule and the config `bashInterceptor` patterns.
