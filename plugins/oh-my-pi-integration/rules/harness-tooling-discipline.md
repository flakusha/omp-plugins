---
name: harness-tooling-discipline
description: "When the agent uses shell/python/bun/external scripts: flag any that replace original harness functionality; strictly-required work becomes re-executable ./.tmp/ files; check/reconciliation logic becomes hooks or shared functions; discover system tools and route execution through harness tooling (lean-ctx, rtk); never evade interception with command/builtin/full-path forms"
condition: ["(?=[\\s\\S]*command (ls|grep|cat|find|rg|sed)|\\bbuiltin\\b|bash -c|/usr/bin/|/bin/(ls|cat|grep|find))(?=[\\s\\S]*bypass|evade|intercept|rewrite|escape[\\s\\S]{0,40}?(harness|tooling)|not captured)(?=[\\s\\S]*which |command -v|tool[\\s\\S]{0,40}?(available|discovery|installed))(?=[\\s\\S]*lean-ctx|\\brtk\\b|ctx_shell)(?=[\\s\\S]*re-executable|\\.tmp/|scratch|reusable (script|hook)|shared function)(?=[\\s\\S]*replace[\\s\\S]{0,40}?harness|harness[\\s\\S]{0,40}?(replace|bypass)|external (script|tooling))"]
scope: ["text", "thinking"]
---

When the agent uses the shell, python, bun, or external scripts and tooling, apply three disciplines: flag replacements, preserve repeatable work, and never evade the harness.

1) FLAG REPLACEMENTS OF HARNESS FUNCTIONALITY:
- If external tooling would REPLACE original harness functionality (read, grep, glob, edit, lsp, specialized tools), FLAG IT: state that this replaces harness X and why Y is required instead. The harness tools exist for correctness — structure-aware, context-compressed, interception-protected (see repo-tooling-scoped-usage, harness-use-readonly-mcp). Silently routing around them is the rerouting anti-pattern.
- If the external tooling is STRICTLY REQUIRED (the harness cannot do the job — a custom transformation, a binary it lacks): recommend creating a RE-EXECUTABLE file under `./.tmp/` (in-repo gitignored scratch — see the in-repo scratchpad rule) instead of a one-off inline command. Re-executable = reproducible, editable, reviewable — the same code every time, not rewritten from memory each session.
- If the external tooling can serve APP/CODE CHECKS AND RECONCILIATION (validators, diff/contract checks, reconciliation passes): make them HOOKS or SHARED FUNCTIONS in the repo — reusable assets, not one-off agent code. The motivation is explicit: avoid losing work and writing the same agent code every time.

2) DISCOVER SYSTEM TOOLS, THEN ROUTE THROUGH HARNESS TOOLING:
- Before using a system tool, DISCOVER it properly — check availability/version (`which`/`command -v`) instead of assuming it exists.
- Then route its execution through the harness's tooling where wrappers exist: lean-ctx and rtk command execution (ctx_shell compression, rtk output routing). The harness routing layer exists to compress large output and manage context — raw invocation that skips it loses that (see the context-tooling discipline: route shell/read/search output through rtk and lean-ctx).

3) NEVER EVADE INTERCEPTION:
- The LLM may try to escape harness tooling via forms not usually captured by interception/rewrite: `command ls`, `command grep`, `builtin`, `env VAR=cmd`, full-path invocations (`/usr/bin/ls`, `/bin/cat`), `bash -c "ls"`, and similar.
- THE RULE: do not use those forms to evade interception. It is a harness-policy violation, AND it loses what the tooling provides — structure-awareness, compression, routing, context economy — while defeating the guards (e.g. the live-session interceptors) that keep sessions correct.
- If the harness blocks a legitimately needed operation, that is a signal to find the SANCTIONED path — the specialized tool, the MCP, or a re-executable `./.tmp/` script (part 1) — not to sneak past the guard.

DON'T OVER-APPLY: not every shell use is a replacement — short fact pipelines and one-binary commands are sanctioned (see the tool policy). The rule targets: (a) silent replacement of harness functionality, (b) one-off unrepeatable scripts where repeatable work is expected, and (c) interception evasion.
