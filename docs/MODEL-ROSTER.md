# Model roster per profile

How providers/models become available in the `glm` and `minimax` omp profiles,
and the config recipes that put them to work. Regenerate facts with
`omp models --json` (add `--profile <name>`); do not trust hardcoded counts —
the shared catalog refreshes in the background.

## Availability mechanics

- omp discovers models from: bundled catalog + `models.yml` + models.dev
  background refresh + discovery providers (see upstream `docs/models.md`).
- A provider is **selectable** when it has credentials in that profile's auth
  storage. No `enabledProviders` is set anywhere in this repo — do not add it:
  an allowlist prunes retry-fallback chains and `web`-role candidates.
- Config assembly: `agent/config.yml` (base) + `profiles/<name>/agent/config.fragment.yml`
  deep-merged by the installer (see PROFILE-LOADER-RESOLUTION.md).

## Provider roster (verified 2026-10-01, omp 18.4.6)

| profile | provider | notes |
|---|---|---|
| glm | `zai` | GLM-5.x family; `glm-5.3` default role, `glm-5.3-flash` smol/tiny |
| glm | `opencode-go` | full gateway roster; free ids: `deepseek-flash`, `longcat-2.5-preview-free`, `ox-alpha-free`, `space-bunny-free` |
| glm | `opencode-zen` | **blocked** — provider refuses coding-agent harness traffic, omp can no longer use it; prune with `disabledProviders` |
| minimax | `minimax-code` | `MiniMax-M3` (default+slow — not budget, but fine for active use), `MiniMax-M2.7-highspeed` (smol — higher quality, good for the 0-shot classifier), M2.x variants incl. `lightning`/`highspeed` (`M2.5-lightning` good enough for small/mechanical tasks). Provider-reported prices are UNRELIABLE — do not trust catalog cost for this provider |
| minimax | `opencode-go` | credential-tier subset of the glm roster |
| minimax | `atlas` | large discovery noise; candidate for `disabledProviders` |
| both | `opencode-zen` | **blocked** — see glm row; do not assign roles to `opencode-zen/*` selectors |

## Recipes

- **Role assignment** (profile fragment `modelRoles:`): `default`, `smol`,
  `tiny`, `slow`, `advisor`, `task` — selector form `provider/model:effort`.
- **Full 18.4.8 role table** (`pi-coding-agent/src/config/model-roles.ts:56-90`,
  verified 2026-10-01): chat-section roles `default`, `smol`, `slow`, `vision`,
  `plan`, `commit`, `tiny`, `memory`, `task`, `advisor`; kind-section roles
  `image`, `web`, `speech`, `dictation`, `judge`. The record is open — custom
  keys (e.g. `fast_worker: "@task"`) resolve as aliases.
  Pinned here: glm — `plan` glm-5.3:high, `commit` mimo-v2.6-flash:off,
  `memory`/`judge` glm-5.3-flash:off, `vision` glm-4.6v-flash (free,
  image-capable); minimax — `plan` M3:high, `commit`/`memory`
  M2.5-lightning:off, `judge` M2.7-highspeed:low, `vision`
  opencode-go/glm-5.3-flash.
  Unpinned on purpose: `task` (role-derived patterns feed the load-spread
  classifier; pinning would freeze every spawn), `web` (no roster model
  declares `webSearch`), `image`/`speech`/`dictation` (no roster models of
  those kinds).
- **Per-subagent override**: `task.agentModelOverrides` record in
  `config.yml`/fragment — keyed by agent name, beats agent frontmatter `model`
  (precedence: request > settings override > agent frontmatter > session model).
- **Picker ordering**: `modelProviderOrder` (roster order), `cycleOrder`
  (Alt+P cycle).
- **Pruning noise / blocked providers**: `disabledProviders: [opencode-zen, atlas]`
  — blocklist, not allowlist. `opencode-zen` blocks harness traffic, so omp
  cannot use it; never assign `opencode-zen/*` selectors to roles or overrides.
- **Dispatch-time model swap**: `before_subagent_spawn` extension hook returns
  `{ model, note }`; last defined handler wins. This plugin ships the
  `load-spread` extension on that hook (see below).
- **Custom task agents**: markdown files with YAML frontmatter discovered
  from (highest wins) `<project>/.omp/agents/`, `~/.omp/agents/`, then each
  plugin package's `agents/` dir (this repo ships `agents/census.md` in the
  `oh-my-pi-integration` package — a read-only `@smol` data-collection agent).
  Frontmatter fields (18.4.8, `discovery/helpers.ts:290-305`): `name` (not
  `main`/`sub`), `description`, `tools` (yield auto-added), `spawns`
  (`"*"` or list), `model` (list, `"@role"` selectors ok — beats session
  model, loses to `task.agentModelOverrides`), `thinkingLevel`, `blocking`,
  `prewalk` (bool/pattern), `advisor` (bool/pattern — subagents run
  UNADVISED by default; core forces `advisor.enabled: false` for spawns,
  `task/executor.ts:1094-1096`), `autoloadSkills`, `readSummarize`,
  `output`.
- **Vibe worker tiers**: `vibe good` runs the bundled `task` agent (inherits
  the strong session model); `vibe fast` runs the bundled `sonic` agent.
  Pin tiers per profile via `task.agentModelOverrides` — this repo pins
  `sonic` to the mechanical tier (`opencode-go/mimo-v2.6-flash:low` on glm —
  cheapest gateway tier at $0.14/$0.28 per Mtok, 1M ctx; qwen3.8-flash is
  NOT budget, $0.15/$0.47 — and `minimax-code/MiniMax-M2.5-lightning:low` on
  minimax, good enough for small tasks; minimax-code prices unreliable);
  `good` stays on the inherit-strong default.
  Alternates: `opencode-go/deepseek-v4.1-flash` ($0.15/$0.60).

## Load-spread classifier (plugin)

`extensions/plugin/load-spread.ts` classifies every role-derived `task` spawn
HEAVY/LIGHT with one 0-shot request on the profile's `@smol` model and reroutes
LIGHT spawns to `PI_LOAD_SPREAD_LIGHT` (default `@smol`). Fail-open; opt out
with `PI_LOAD_SPREAD_DISABLE=1`. 18.4.6's `BeforeSubagentSpawnEvent` carries no
assignment text, so the handler stashes `task`-tool input at `tool_call` time
and consumes it FIFO at spawn time (per agent name) — no core patch needed.

## Verification

```sh
omp --profile glm models --json      # census per profile
```
