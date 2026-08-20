# omp-plugins

Installable [oh-my-pi](https://omp.sh) (omp) plugin bundle. It extends an omp agent
with context-cost controls, durable memory, dangerous-command guards, and a
project skill — all loadable into any omp profile.

## What's included

| Piece | Path | Loaded by omp via |
|---|---|---|
| Integration extension — rtk/lean-ctx bash rewrite, engram memory auto-save + turn-start retrieval, GPG/SSH hard-stop guards | `plugins/oh-my-pi-integration/extensions/index.ts` (+ `guards/`) | `package.json` → `omp.extensions` |
| Universal project rules — harness behavior, tool-routing discipline, strict review standards, docs-and-planning audit, parallel-safe tests, config merge precedence, safe-command guards | `plugins/oh-my-pi-integration/rules/` | `~/.omp/agent/rules/` **and** `~/.omp/rules/` (both; root-level is picked up directly by omp) |
| omp-specific global agent rules (lean-ctx tool-call corrections) | `AGENTS.md` | `agent/AGENTS.md` |
| Agent config scaffold (no credentials) | `agent/config.yml` | `agent/config.yml` |

The bundle also ships a `.omp-plugin/marketplace.json` catalog so the contained
plugin can be installed directly with `omp plugin install`.

### What the extension does

- **Bash tool-call rewrite** — rewrites simple `bash` tool calls to use `rtk`
  (output trimming) or `lean-ctx -c` (compression) so agent tool output costs
  less context. Only single, simple commands are rewritten; anything ambiguous,
  PTY, or async is passed through untouched. rtk subcommands are discovered at
  runtime from the installed binary (`rtk --help`) and gated behind a curated
  safety set — version drift or a missing rtk falls through to lean-ctx.
- **Engram memory persistence** — buffers notable mutations each turn and saves
  them to [engram](https://engram.sh) at turn end and session shutdown, so later
  sessions can reuse recorded solutions.
- **Turn-start retrieval** — when enabled, distills the user prompt into a
  keyword query and injects prior project memories back into the agent loop
  (best-effort, bounded, never blocking).
- **GPG & SSH hard-stop guards** — when a commit signing or ssh-agent/socket
  failure needs a human (locked GPG key, stale SSH agent), substitutes an
  imperative hard-stop directive and blocks the agent's usual self-recovery
  commands (`gpgconf`, `gpg-agent`, `ssh-agent` lifecycle, socket reassignment,
  passphrase bypass).
- **Destructive-git guard** — notifies (never blocks) when a `git` command
  would destroy work (`reset --hard`, `clean -f`, `push -f`, `branch -D`,
  `stash`, `checkout --`, …) so the agent sees the risk before committing.
- **Post-edit lint feedback** — after a successful `edit`/`write` of a TS
  file, runs the project's biome on that file and surfaces diagnostics in the
  tool result (best-effort, bounded; resolves the repo-local biome from
  `node_modules/.bin`, falling back to PATH).
- **Compaction preservation** — on `session.compacting`, injects the
  in-flight mutation buffer into the compaction summary so no uncommitted work
  is lost across a compaction (`harness-evasion-guard` pre-hook additionally
  blocks agent attempts to bypass the read-only harness tools in the shell).

All guards live as pure, unit-tested logic in `extensions/guards/`: they take
command/output strings and return decisions, so behavior is auditable without a
harness.

## Universal project rules

Rules live in `plugins/oh-my-pi-integration/rules/` and are installed to **both**
`<target>.omp/agent/rules/` (agent-scoped, backward-compat) **and**
`<target>.omp/rules/` (root-level, picked up directly by omp). Each rule has YAML
frontmatter:
```yaml
---
name: <filename-stem>
description: "<one-line purpose>"
condition: ["<regex-with-lookahead-AND-facets>"]
scope: ["text", "thinking"]
---
<imperative steering content>
```

### Condition semantics — AND across facets

The ttsr engine compiles each `condition:` array element into an independent
RegExp and triggers when **any** one matches (OR). To express AND (all facets
must co-appear in the assistant's stream), each rule's condition is a single
regex using lookahead chains:

```
^(?=[\s\S]*facet1)(?=[\s\S]*facet2)(?=[\s\S]*facet3)...
```

This fires only when the assistant's streamed text/thinking contains all
facets. A rule with a single facet is unchanged.

**Always anchor the chain with `^`.** Without it the zero-width lookahead
regex has no anchor, so on non-matching input `.test()` re-runs the greedy
`[\s\S]*` scan at every stream position — O(n²) ReDoS (measured ~2.3 s across
75 rules on an 8 KB non-match vs ~1.2 ms anchored). Anchoring is semantically
identical: each facet's `[\s\S]*` already scans the whole stream from
position 0. `scripts/check-regex-safety.sh` (wired into `bun run verify`)
errors on any unanchored lookahead chain and on unbounded `.*`.

### Scope conventions

| Scope | Fires on | Use for |
|---|---|---|
| `text` | assistant prose | reminders about approach, quality, conventions |
| `thinking` | assistant internal reasoning | same as text, for thinking blocks |
| `tool:bash` | bash tool-call composition | preventing specific commands or tool misuse |
| `tool:edit` / `tool:write` | edit/write tool calls | file-content rules |

Rules about **preventing specific commands** (e.g. `git status` during
implementation) should scope to `tool:bash` only — scoping to `text` causes
them to fire during review/discussion where the commands are legitimate.

## Install

```bash
# install into an isolated omp profile root (default target)
bash scripts/install.sh

# explicit target (PREFIX or --target)
PREFIX=/tmp/omp-test bash scripts/install.sh
bash scripts/install.sh --target /tmp/omp-test

# overwrite an existing install; or preview without writing
bash scripts/install.sh --force
bash scripts/install.sh --dry-run

# update your live profile directly (e.g. AGENTS.md, rules, extensions)
bash scripts/install.sh --target "$HOME/.omp" --live
```

The installer lays the payloads into:
- `TARGET/.omp/agent/` — `AGENTS.md`, `config.yml`, `extensions/`, `hooks/pre/`
- `TARGET/.omp/agent/rules/` — universal project rules (agent-scoped, backward-compat)
- `TARGET/.omp/rules/` — universal project rules (root-level, picked up directly by omp)
- `TARGET/.omp/profiles/<name>/agent/` — per-profile config from `profiles/<name>/agent/` in the repo
- `TARGET/.omp/plugins/` — plugin registry

When `TARGET` is itself a profile root (e.g. `~/.omp`), the bundle is laid down
directly under it without nesting a second `.omp`. It writes only bundle-owned
files and never touches databases, sessions, caches, or memories. It refuses to
run against your live home profile unless you pass `--live` (use an isolated
target such as `/tmp/omp-test` by default), then point a scratch profile at it
with `omp --profile test`.

Re-runs are safe and manifest-driven: an ownership ledger records every file
the installer wrote. On re-run, installer-owned files are updated in place
(rules added, changed, or renamed synchronize without `--force`), files that no
longer ship are removed, and files you modified locally (or never installed)
are kept with a notice — never clobbered without `--force`, which overwrites
them while keeping the previous copy as `<dst>.bak`. Symlinked destinations are
never followed; every touched path is checked to stay inside `TARGET`.

## Extension runtime options

| Environment variable | Effect |
|---|---|
| `PI_INTEGRATION_DISABLE=1` | Disable the whole integration extension |
| `PI_INTEGRATION_RETRIEVE=1` | At turn start, retrieve prior engram memories for the project and inject a bounded context block |
| `PI_RETRIEVE_EVERY_TURN=1` | Re-retrieve every turn (default: once per session) |

## Development

Requires [bun](https://bun.sh) — the omp runtime runs on bun and
`@oh-my-pi/pi-coding-agent` is consumed as raw TypeScript via its `exports` map.

```bash
bun install        # install toolchain (@oh-my-pi/pi-coding-agent, biome, typescript)
bun run verify     # lint + typecheck + test
```

| Script | What it runs |
|---|---|
| `verify` | `lint` → `typecheck` → `test` → `check:rules` → `check:ship` |
| `lint` / `lint:fix` | Biome check, then the console-log gate (`check-no-console.sh`) — `lint:fix` also applies safe fixes + import sorting |
| `typecheck` | `tsc --noEmit` over `plugins/**/*.ts` |
| `test` | `bun test` — guard unit tests in `extensions/guards/__tests__/` and hook tests |
| `check:rules` | `check-rules-sync.sh` — validates every rule's frontmatter (name == filename, description/condition non-empty, valid scope) and syncs against the installer laydown |
| `check:ship` | `check-shipment.sh` — installs into a temp target and asserts no `__tests__/` dirs ship, no `.bak`/`.original` files, and only `index.ts` at top of `agent/extensions/` |
| `install:test` | `scripts/install.sh --target /tmp/omp-test` |

Linting, types, tests, and the rules bundle are all exercised together by
`bun run verify`, which is the standard pre-commit / CI gate for this
repository.

> **Note on Biome and regex guards.** `noUselessStringRaw` is disabled in
> `biome.json` because the guard modules build regexes from `String.raw`
> literals that contain regex escapes (`\s`, `\d`). Biome's rule only checks
> JavaScript escape sequences (`\n`, `\t`, `\\`, …) and would propose removing
> `String.raw` from literals whose backslash-escapes are meaningful to the
> regex — silently changing `\s` into `s`. Keeping the rule on would invite a
> corrupting fix on security-critical enforcement code.

## Layout

```
├── .omp-plugin/marketplace.json   catalog for `omp plugin install`
├── AGENTS.md                      omp-specific global agent rules (installed to <target>.omp/agent/AGENTS.md)
├── agent/config.yml               agent config scaffold (credential-free)
├── plugins/oh-my-pi-integration/  the plugin package (extensions/hooks/rules)
│   └── rules/                     universal project rules (installed to both
│                                  <target>.omp/agent/rules/ and <target>.omp/rules/)
├── profiles/                      per-profile scaffolds (installed to <target>.omp/profiles/<name>/agent/)
│   └── bytedance/
│       └── agent/
│           └── config.yml         BytePlus/bytedance-seed-code profile
├── scripts/install.sh             installer for an isolated omp profile
├── biome.json                     lint/format config
├── tsconfig.json                  TS config (moduleResolution: bundler)
├── package.json / bun.lock        bun dev tooling (typecheck, lint, test)
└── LICENSE
```

## Profiles

OMP supports multiple named profiles under `~/.omp/profiles/`. Each profile has its own
`agent/config.yml` (model, provider, memory backend) and optionally its own
`agent/AGENTS.md`. Profile settings override the base `~/.omp/agent/` defaults.

The bundle ships a `profiles/` directory in the repo; `install.sh` scaffolds any
profile it finds there (currently `bytedance`). To add a new profile:

1. Create `profiles/<name>/agent/config.yml` in the repo — model roles, provider,
   and any per-profile overrides. See `profiles/bytedance/agent/config.yml` for a
   starting template.
2. Optionally add `profiles/<name>/agent/AGENTS.md` for profile-scoped rules.
3. On the next `install.sh --target ~/.omp --live`, the profile is scaffolded
   automatically.

Switch profiles at runtime:

```bash
omp --profile bytedance   # BytePlus / bytedance-seed-code
omp --profile minimax     # MiniMax-M3
omp --profile default     # base profile
```

## License

[MIT](LICENSE)
