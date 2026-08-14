# omp-plugins

Installable [oh-my-pi](https://omp.sh) (omp) plugin bundle. It extends an omp agent
with context-cost controls, durable memory, dangerous-command guards, and a
project skill — all loadable into any omp profile.

## What's included

| Piece | Path | Loaded by omp via |
|---|---|---|
| Integration extension — rtk/lean-ctx bash rewrite, engram memory auto-save + turn-start retrieval, GPG/SSH hard-stop guards | `plugins/oh-my-pi-integration/extensions/index.ts` (+ `guards/`) | `package.json` → `omp.extensions` |
| Native-tool → lean-ctx re-route hook | `plugins/oh-my-pi-integration/hooks/pre/lean-ctx-native-reroute.ts` | `agent/hooks/pre/` |
| Loop-Lore world-timeline skill | `plugins/oh-my-pi-integration/skills/loop-lore-world-timeline/SKILL.md` | `agent/skills/` |
| Agent config scaffold (no credentials) | `agent/config.yml` | `agent/config.yml` |

The bundle also ships a `.omp-plugin/marketplace.json` catalog so the contained
plugin can be installed directly with `omp plugin install`.

### What the extension does

- **Bash tool-call rewrite** — rewrites simple `bash` tool calls to use `rtk`
  (output trimming) or `lean-ctx -c` (compression) so agent tool output costs
  less context. Only single, simple commands are rewritten; anything ambiguous,
  PTY, or async is passed through untouched.
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

All guards live as pure, unit-tested logic in `extensions/guards/`: they take
command/output strings and return decisions, so behavior is auditable without a
harness.

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
```

The installer lays the payloads into `TARGET/.omp/agent/` (`config.yml`,
`extensions/`, `hooks/pre/`, `skills/`) and registers the plugin package under
`TARGET/.omp/plugins/`. It writes only bundle-owned files and never touches
databases, sessions, caches, or memories. It refuses to run against your live
home profile (use an isolated target, e.g. `/tmp/omp-test`), then point a
scratch profile at it with `omp --profile test`.

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
| `verify` | `lint` → `typecheck` → `test` |
| `lint` / `lint:fix` | [Biome](https://biomejs.dev) check (`lint:fix` applies safe fixes + import sorting) |
| `typecheck` | `tsc --noEmit` over `plugins/**/*.ts` |
| `test` | `bun test` — guard unit tests in `extensions/guards/__tests__/` |
| `install:test` | `scripts/install.sh --target /tmp/omp-test` |

Linting, types, and tests are all exercised together by `bun run verify`, which
is the standard pre-commit / CI gate for this repository.

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
├── agent/config.yml               agent config scaffold (credential-free)
├── plugins/oh-my-pi-integration/  the plugin package (extensions/hooks/skills/manifest)
├── scripts/install.sh             installer for an isolated omp profile
├── biome.json                     lint/format config
├── tsconfig.json                  TS config (moduleResolution: bundler)
├── package.json / bun.lock        bun dev tooling (typecheck, lint, test)
└── LICENSE
```

## License

[MIT](LICENSE)
