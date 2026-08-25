# Global Agent Instructions (oh-my-pi / omp)

Agent-scoped rules for this oh-my-pi (omp) agent. Wire into a home/global
config via `scripts/install-global-agents.sh`.

<!-- lean-ctx -->
## lean-ctx

Prefer lean-ctx MCP tools over native equivalents for token savings.

For compression you can rely on regardless of your code surface or version,
route shell commands through `ctx_shell` (or
`/home/flak/node_modules/lean-ctx-bin/bin/lean-ctx -c "<cmd>"`), file reads
through `ctx_read`, and code search through `ctx_search`. Hook-driven
auto-compression may also be active, but the MCP/CLI tools are the path that
works everywhere — otherwise large outputs (builds, `tsc`, tests, logs) can
reach the model uncompressed.

Full rules: `/home/flak/.codex/LEAN-CTX.md`
<!-- /lean-ctx -->

### Tool-call corrections — do not fight blocked native tools

When a native tool call is BLOCKED or redirected with a "use the
`mcp__lean_ctx_ctx_*`/`ctx_*` tool" / "Use the `grep` tool instead of …" notice,
STOP and route that exact call through the sanctioned tool:

| Blocked native call | Route to |
|---|---|
| `read` on a directory / `ls` / `find` | `ctx_tree` (dirs) |
| `bash` command (incl. `cat`/`head`/`tail`/`grep`/`rm`/`sed`) | `ctx_shell` with JSON `{"command": "…"}` |
| `grep`/`rg` (repo search) | `ctx_search` with JSON `{"pattern": "…", "path": "…"}` |
| `glob` / `find` patterns | `ctx_glob` with JSON `{"pattern": "…"}` |
| file read | `ctx_read` with JSON `{"path": "…", "mode": "…"}` |

NEVER retry the native equivalent, reword it, or reach for another native tool
to dodge the block. A redirect is the sanctioned path, not an error to work
around.

Notes:
- `ctx_shell` / `ctx_search` / `ctx_glob` take a **single JSON string** as
  input: `{"command": "…"}`, `{"pattern": "…", "path": "…"}`, `{"pattern": "…"}`.
  A bare command string (e.g. `ls`) is a JSON parse error.
- `ctx_shell` enforces an allowlist (`bash`, `lean-ctx`, …). A blocked binary
  is a deliberate policy — for trusted one-off verification use the native
  `bash` tool, not a workaround inside `ctx_shell`.
- `ctx_read`/`ctx_search`/`ctx_glob` are confined to the project root; for
  paths outside it (e.g. `~/.codex/…`) use the native `read`/`grep`/`glob`
  tools — those calls are exempt from the lean-ctx redirect there. Inside
  the project root they are always redirected, so don't start there.
