Route every command execution and code edit through the harness tooling. Native equivalents are intercepted, blocked, or uncompressed — raw invocation loses structure-awareness, output compression, and guards, and silently routes around the policy layer.

- Long-running work (dev servers, watchers, test watch mode, background jobs): the `hub` tool (`op:"start"`), never nohup or trailing `&` — stays observable and addressable across turns; anything else is invisible to sibling sessions.
- Writes belong in-repo (project files, `./.tmp/` scratch). Never write outside the project root via redirection, tee, or heredoc; never system directories.
- Reference, not replacement: details and enforcement in the `harness-tooling-discipline` rule and the config `bashInterceptor` patterns.
