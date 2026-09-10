# Global Agent Instructions (oh-my-pi / omp)

Agent-scoped rules for this oh-my-pi (omp) agent. Wire into a home/global
config via `bun scripts/install.ts --target ~/.omp --live`.

<!-- lean-ctx -->
## lean-ctx

Prefer lean-ctx MCP tools over native equivalents for token savings.

For compression you can rely on regardless of your code surface or version,
use the lean-ctx MCP tools (`mcp__lean_ctx_ctx_shell`, `mcp__lean_ctx_ctx_read`,
`mcp__lean_ctx_ctx_search`, `mcp__lean_ctx_ctx_glob`, `mcp__lean_ctx_ctx_tree`).
Hook-driven auto-compression may also be active, but the MCP tools are the
path that works everywhere — otherwise large outputs (builds, `tsc`, tests,
logs) can reach the model uncompressed.

### Tool-call corrections — do not fight blocked native tools

When a native tool call is BLOCKED or redirected with a "use the
`mcp__lean_ctx_ctx_*`/`ctx_*` tool" / "Use the `grep` tool instead of …" notice,
STOP and route that exact call through the sanctioned tool:

| Blocked native call | Route to |
|---|---|
| `read` on a directory / `ls` | `ctx_tree` |
| `bash` command (incl. `cat`/`head`/`tail`/`grep`/`rm`/`sed`) | `ctx_shell` with JSON `{"command": "…"}` |
| `grep`/`rg` (repo search) | `ctx_search` with JSON `{"pattern": "…", "path": "…"}` |
| `glob` / `find` patterns | `ctx_glob` with JSON `{"pattern": "…"}` |
| file read | `ctx_read` with JSON `{"path": "…", "mode": "…"}` |
| `edit` (native) | `ctx_patch` — `ctx_read` with `mode:"anchored"` first, then JSON `{"path": "…", "op": "…"}` (set_line / replace_lines / insert_after / delete / replace_unique / replace_symbol / replace_all / create) |

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
- `ctx_read`/`ctx_search`/`ctx_glob`/`ctx_patch` are confined to the project
  root; for paths outside it (e.g. `~/.codex/…`) use the native
  `read`/`grep`/`glob`/`edit` tools — those calls are exempt from the
  lean-ctx redirect there. Inside the project root they are always
  redirected, so don't start there.

### Wrapper forms — when `bash` is the only surface

Inside `bash`, route shell work through the compression wrappers. Prefer in
this order: MCP `ctx_*` tools → `lean-ctx -c "…"` → `rtk` → plain binary.

| Form | Example | When |
|---|---|---|
| MCP `ctx_shell` | `{"command": "bun test src/foo.test.ts"}` | always preferred |
| `lean-ctx` single wrap | `lean-ctx -c "bun run check"` | bash one-liners needing compression |
| `lean-ctx` wrapping `rtk` | `lean-ctx -c "rtk git status"` | rtk-targeted output compression |
| bare `rtk` | `rtk read src/foo.ts` | direct rtk subcommand use |

Single-wrap invariant: exactly one `lean-ctx -c` layer. `lean-ctx -c
"lean-ctx -c \"…\""` is disallowed (no added compression; the outer string
is an env-flag injection point). One command per `-c` string; for complex
logic write a re-executable `<repo>/.tmp/<name>.{js,py}` and invoke it with
`lean-ctx -c "cd <repo> && bun <name>.js"`.
