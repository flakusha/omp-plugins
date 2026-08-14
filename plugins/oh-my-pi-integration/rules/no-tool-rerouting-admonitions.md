---
name: no-tool-rerouting-admonitions
description: "Stop inserting lean-ctx/MCP rerouting admonitions into tool-call intent fields; call built-in read/grep/glob directly and only switch tools on concrete failures"
condition: "Use (ctx_search|ctx_read|ctx_glob|mcp__lean_ctx).*instead|instead of (read|grep|glob)|instructing|admonition"
scope: "text"
---

Do not embed rerouting advisories like 'Use ctx_search instead of grep' in assistant prose or tool-call intent (`i`) fields. Call the built-in `read`/`grep`/`glob` directly with the real path or glob — they remain the correct, working choice. Only switch tools when an actual tool result fails or the task's own rules mandate a specific path. Keep tool calls minimal and keep the conversation moving without deliberating on which tool wrapper to use.
