---
name: harness-tooling-discipline
description: "When the agent uses shell/python/bun/external scripts: flag any that replace original harness functionality; strictly-required work becomes re-executable ./.tmp/ files; check/reconciliation logic becomes hooks or shared functions; discover system tools and route execution through harness tooling; never evade interception with command/builtin/full-path forms; eval is disabled — computation becomes re-executable ./.tmp/ scripts, never interpreter-inline forms; native write is .tmp/-scratch-only, in-repo files go through ctx_patch"
condition: ["^(?=[\\s\\S]*command (ls|grep|cat|find|rg|sed)|\\bbuiltin\\b|bash -c|/usr/bin/|/bin/(ls|cat|grep|find))(?=[\\s\\S]*bypass|evade|intercept|rewrite|escape[\\s\\S]{0,40}?(harness|tooling)|not captured)(?=[\\s\\S]*which |command -v|tool[\\s\\S]{0,40}?(available|discovery|installed))(?=[\\s\\S]*harness)(?=[\\s\\S]*re-executable|\\.tmp/|scratch|reusable (script|hook)|shared function)(?=[\\s\\S]*replace[\\s\\S]{0,40}?harness|harness[\\s\\S]{0,40}?(replace|bypass)|external (script|tooling))"]
scope: ["text", "thinking"]
---

When using the shell, python, bun, or external tooling, apply four disciplines: flag replacements, discover-then-route, never evade, compute via ./.tmp/ scripts.

BLOCKED-COMMAND PROTOCOL: when a tool result returns a block reason (`matched: … fix: …`), read the `fix:` line and apply it verbatim — never retry the blocked shape with cosmetic variants.

1) FLAG REPLACEMENTS: silently routing around harness functionality (read/grep/glob/edit/lsp/specialized tools) is the rerouting anti-pattern — flag it and state why the alternative is required (see repo-tooling-scoped-usage; the reroute pre-hook escalates in-root `glob`/`edit`/`write` to the lean-ctx MCP). Harness-mandatory external tooling → a RE-EXECUTABLE `./.tmp/` file (reproducible, editable, reviewable — not one-off inline commands). Check/reconciliation logic → repo HOOKS or SHARED FUNCTIONS.

2) DISCOVER, THEN ROUTE: check availability with `which`/`command -v` instead of assuming; then prefer dedicated tools — raw binaries lose structure-awareness, compression, and context economy.

3) NEVER EVADE INTERCEPTION: no `command`/`builtin`/`env VAR=cmd`/full-path/`bash -c "…"` forms to dodge interception — harness-evasion-guard blocks them, and they defeat the guards that keep sessions correct. A block on a legitimately needed operation means find the SANCTIONED path (specialized tool, MCP, or a `./.tmp/` script), not a workaround.

4) EVAL DISABLED, WRITES GATED: the `eval` tool is off profile-wide; interpreter-inline forms (`python -c`, `node -e`/`-p`, `perl -e`/`-pe`, `deno eval`, heredoc-to-interpreter, piped bare interpreter) are blocked the same way. Computation = re-executable `./.tmp/` script run via bash (`python .tmp/x.py`, `bun .tmp/x.ts`). Native `write` is only for in-root `.tmp/` scratch, `xd://` device dispatch, and `local://` plan artifacts; in-repo project files go through `ctx_patch` (op `create`); out-of-root and `ssh://` targets are blocked.

DON'T OVER-APPLY: short fact pipelines and one-binary commands are sanctioned (see the tool policy). Targets: (a) silent harness replacement, (b) one-off unrepeatable scripts, (c) interception evasion.
