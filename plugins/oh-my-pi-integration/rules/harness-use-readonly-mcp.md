---
name: harness-use-readonly-mcp
description: "Native grep is wired to lean-ctx and shell rg/grep are blocked — use the read-only lean-ctx MCP tool directly"
condition: ["(?=[\\s\\S]*\\brg\\b)(?=[\\s\\S]*ripgrep)(?=[\\s\\S]*\\bgrep\\b)(?=[\\s\\S]*pattern)"]
scope: ["tool:bash", "tool:grep"]
---

In this harness the native `grep` tool is wired to lean-ctx and shell `rg`/`grep` are blocked (they return redirects telling you to use the read-only MCP tool). Don't fight it.

Use the read-only lean-ctx MCP tools directly:
- `xd://mcp__lean_ctx_ctx_search` — `write` JSON `{"pattern","path","action":"regex|semantic|symbol"}`
- `xd://mcp__lean_ctx_ctx_read` for file reads, `xd://mcp__lean_ctx_ctx_glob` for globs, `xd://mcp__lean_ctx_ctx_tree` for trees

Try the read-only MCP tool first and be happy — no bash rg, no native grep.
