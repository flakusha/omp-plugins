---
name: bash-read-family-prefer-read-tool
description: "The bash tool with cat/head/tail/less/more passes through a dispatch bridge that rewrites to rtk read; the harness exposes the lean-ctx MCP protocol via xd://mcp__lean_ctx_ctx_* device URLs for cases where the wrapper MCP tool does not surface a needed mode"
condition: ["(?:^|\\b)(cat|head|tail|less|more)(?:\\s+-[\\w-]+)*\\s+([^\\s|;&<>]+)|(?:^|\\b)(cat|head|tail|less|more)\\s+([^\\s|;&<>]+)|\\b(?:ba|z|d)?sh\\s+-c\\s+[\"'\\x27]?[^\\n\"'\\x27]{0,200}\\b(?:cat|head|tail|less|more)\\b"]
scope: ["tool:bash", "text", "thinking"]
---

The built-in `read` tool is the primary for file reads. `bash` with `cat`/`head`/`tail`/`less`/`more` is the fallback when `read` cannot do the job (byte counts, special-chars display, binary filtering, or multi-file flows the read tool does not expose). This rule documents the dispatch layer that handles the fallback path and the in-process MCP protocol surface that `read` does not reach on its own.

## (1) Bash read-family dispatch — what happens to `bash "cat file"`

When `bash` receives a simple read-family command (`cat file`, `head -n 5 file`, `tail -n 5 file`, `less file`, `more file`), the dispatch bridge (`plugins/oh-my-pi-integration/extensions/index.ts` `nativeToRtk`) rewrites the command to a `bash "rtk read …"` invocation before execution. Argument shapes translate:

- `cat [flags] <files...>` → `rtk read [flags] <files...>` (cat -A/-E/-T/-v fall through unchanged — rtk read does not expose them)
- `head [-n N | -N] [file]` → `rtk read [--max-lines N] [file]` (head -c N falls through unchanged — byte count is not in rtk read's surface)
- `tail [-n N | -N] [file]` → `rtk read [--tail-lines N] [file]` (tail -c N falls through unchanged)
- `less [-N] <file>` → `rtk read [-N] <file>`
- `more <file>` → `rtk read <file>`

The bridge is what `bashInterceptor` does NOT cover (it routes `cat`/`head`/`tail`/`less`/`more` to the native `read` tool, but if the LLM still emits `bash` with these binaries, the dispatch bridge compresses them rather than letting the raw call run). The rewrite is silent — no tool-call response annotates it.

Composing `bash -c "cat …"` or full-path `/usr/bin/cat` to evade the bridge skips the rewrite and runs the native binary; this is the evasion pattern that `harness-tooling-discipline` covers. The bridge does not detect wrapped invocations.

## (2) Lean-ctx MCP device endpoints — the in-process protocol surface

The lean-ctx MCP server is reachable two ways. The first is the LLM-facing tool names (`mcp__lean_ctx_ctx_read`, `mcp__lean_ctx_ctx_search`, `mcp__lean_ctx_ctx_glob`, `mcp__lean_ctx_ctx_tree`, `mcp__lean_ctx_ctx_shell`) — the wrapper surface documented by `harness-use-readonly-mcp`. The second is the in-process `xd://` device URL form, which goes through `XdProtocolHandler` (`@oh-my-pi/pi-coding-agent/dist/types/internal-urls/xd-protocol.d.ts`) and accepts the same JSON arguments the wrapper tool would pass through, plus additional modes / parameters the wrapper may not surface:

- `xd://mcp__lean_ctx_ctx_read` — `{"path": "...", "mode": "full|anchored|signatures|map"}`
- `xd://mcp__lean_ctx_ctx_search` — `{"pattern": "...", "path": "...", "action": "regex|semantic|symbol"}`
- `xd://mcp__lean_ctx_ctx_glob` — `{"pattern": "..."}`
- `xd://mcp__lean_ctx_ctx_tree` — `{"path": "...", "depth": N}`
- `xd://mcp__lean_ctx_ctx_shell` — `{"command": "..."}`
- `xd://mcp__lean_ctx_ctx_call` — `{"tool": "<wrapper-name>", "arguments": {...}}` (generic dispatch to any registered MCP tool by its `mcp__<server>_<tool>` name)

The device form is reached via `write xd://...` with JSON content. It is the same wire protocol as the wrapper tools; the wrapper exists to provide default parameters and to register with the LLM's tool surface.

The two surfaces are not additive alternatives — they are the same MCP server reachable via two interface contracts. The wrapper tool is the registered LLM-callable surface; the device URL is the registered in-process dispatch surface. Either reaches the same server; the device form is the LLM-side path to modes the wrapper does not expose.

## TIES

- `harness-use-readonly-mcp` — the wrapper tool names. The bridge in (1) and the device form in (2) are the surface `harness-use-readonly-mcp` does not cover.
- `harness-tooling-discipline` — covers the wrap-evasion pattern that defeats (1).
- The ban on rerouting prose in tool-call intent fields: pick the tool, don't write prose about which to pick.

## Architectural note

The dispatch bridge in `extensions/index.ts` `nativeToRtk` is the MAXIMUM compression achievable at the hook/extension layer. Hooks cannot reshape `toolName` (`bash` stays `bash`), `ExtensionContext` does not expose MCP client APIs to extensions, and there is no `xd` CLI binary — so the dispatch layer can rewrite to rtk but cannot route `bash "cat file"` to `mcp__lean_ctx_ctx_read`. The two ways to reach MCP for read-family commands are (a) the LLM choosing the built-in `read` tool at prompt time, or (b) upstream omp exposing MCP client to extensions (see the open issue). Until then, the `xd://mcp__*` device form is the LLM-side path to the protocol.