# Profile loader resolution — `--profile X` doesn't pick up runtime stores

**Status:** Option 1 (profile runtime symlinks) implemented 2026-08-25; upstream omp loader fallback fix (Option 4) still pending.
**Author:** Main agent, session 2026-08-25.
**Affected scopes:** any omp profile whose name is not the default (`agent`).

---

## TL;DR

When `--profile <name>` is set, omp's rule loader resolves the
`oh-my-pi-integration` plugin manifest's relative paths against the **active
agent directory** (e.g. `~/.omp/profiles/minimax/agent/`), not against the
default `~/.omp/agent/`. The manifest's entries are of the form
`agent/rules/...`, `agent/hooks/pre/...`, `agent/extensions/...`. Under a
named profile those resolve to paths that don't exist
(`~/.omp/profiles/minimax/agent/agent/rules/...`), so the loader finds zero
user-authored rules, zero hooks, zero extensions, zero skills.

The profile's `config.yml` and `AGENTS.md` ARE picked up — those load via a
separate code path. Only the manifest-resolved files fail.

The repo's design is **correct** (profile configs only; runtime stores
shared). The bug is in omp's loader, not in this repo. But the repo CAN
ship a layout that doesn't depend on the loader's resolution behavior.

---

## What the evidence says

### Filesystem (live, verified)

```
~/.omp/                                 # omp root
├── agent/                              # default profile
│   ├── AGENTS.md
│   ├── config.yml
│   ├── extensions/                     ← rules/hooks/extensions land here
│   │   ├── index.ts                    ← integration extension entry
│   │   ├── guards/{gpg,ssh,git-destructive}-guard.ts
│   │   └── util/lint-feedback.ts
│   ├── hooks/pre/
│   │   ├── harness-evasion-guard.ts
│   │   └── lean-ctx-native-reroute.ts
│   ├── rules/                          ← 75+ rule .md files (canonical)
│   │   ├── harness-tooling-discipline.md
│   │   ├── harness-use-readonly-mcp.md
│   │   ├── no-tool-rerouting-admonitions.md
│   │   ├── no-unsourced-framework-claims.md
│   │   └── ... (75+ more)
│   └── skills/
│
├── profiles/
│   ├── minimax/agent/                  # minimax profile (broken)
│   │   ├── AGENTS.md                   ✓ loaded
│   │   ├── config.yml                  ✓ loaded
│   │   ├── agent.db                    ✓ isolated storage
│   │   └── (no rules/, hooks/, extensions/, skills/)
│   └── bytedance/agent/                # bytedance profile (same shape, same bug)
│       ├── config.yml
│       └── (no AGENTS.md, no rules/, hooks/, extensions/, skills/)
│
├── plugins/
│   └── oh-my-pi-integration.manifest   # manifest entries use agent/...
│
├── rules/                              # top-level duplicate of agent/rules/
├── hooks/                              # top-level duplicate of agent/hooks/
├── extensions/                         # top-level duplicate of agent/extensions/
└── skills/
```

Both `~/.omp/agent/rules/harness-tooling-discipline.md` and
`~/.omp/rules/harness-tooling-discipline.md` exist and are **byte-identical**
(`#9896` snapshot tag confirmed for the harness rule). The top-level
`rules/`, `hooks/`, `extensions/`, `skills/` directories exist alongside
the agent-scoped ones. Both contain the same content. The current installer
(`scripts/install.sh` line 431-432) writes rules to **both** locations.

### Log evidence — default profile session (pid 73290)

Read from `~/.omp/logs/omp.2026-08-25.73290.log`:

```
16:38:07.593  TTSR rule registered  harness-use-readonly-mcp
16:38:07.593  TTSR rule registered  no-git-state-investigation
16:38:07.593  TTSR rule registered  no-tool-rerouting-admonitions
16:38:07.593  TTSR rule registered  no-unsourced-framework-claims
16:38:07.593  TTSR rule registered  plan-docs-cross-staleness
16:38:07.593  TTSR rule registered  plan-sync-after-epic-updates
16:38:07.593  TTSR rule registered  premature-task-complete
... (75+ user rules total, all registered between 16:38:07.593 and 16:38:07.595)
16:38:07.594  TTSR rule registered  repo-tooling-scoped-usage
16:38:07.594  TTSR rule registered  harness-tooling-discipline
16:38:07.595  TTSR rule registered  ts-no-any
... (language-specific builtins continue)
16:47:27      TTSR condition matched  ruleName:strict-review-standards  source:thinking
... (rules FIRE during the session)
```

**All 75+ user-authored rules register AND fire.**

### Log evidence — `--profile minimax` session (pid 292911)

Read from `~/.omp/profiles/minimax/logs/omp.2026-08-25.292911.log`:

```
17:15:05.638  TTSR rule registered  go-add-cleanup
17:15:05.638  TTSR rule registered  go-bench-loop
17:15:05.638  TTSR rule registered  ts-bare-catch
17:15:05.638  TTSR rule registered  ts-import-type
17:15:05.638  TTSR rule registered  ts-no-any
... (26 built-in language rules only)
17:15:06.947  MCP tool load failed   path:mcp:fetch  error:Transport closed
17:15:07.935  MCP prompt commands refreshed  path:mcp:context7
17:15:08.089  MCP prompt commands refreshed  path:mcp:deepwiki
17:15:08.645  MCP prompt commands refreshed  path:mcp:serena
17:15:09.202  MCP prompt commands refreshed  path:mcp:RivalSearchMCP
17:20:27.404  Auto-compaction threshold decision  ...  thresholdTokens:200000
```

**26 rules register** (the built-in language-specific ones). **Zero**
user-authored rules. **Zero** `TTSR condition matched` events during the
session. The `thresholdTokens: 200000` at 17:20:27 confirms
`profiles/minimax/agent/config.yml` IS being read (only the minimax
profile has that compaction override). So the profile config loads; the
manifest-resolved files do not.

### Manifest content

`~/.omp/agent/plugins/oh-my-pi-integration.manifest` lists:

```
F <hash> agent/extensions/index.ts
F <hash> agent/extensions/guards/{gpg,ssh,git-destructive}-guard.ts
F <hash> agent/extensions/util/lint-feedback.ts
F <hash> agent/hooks/pre/harness-evasion-guard.ts
F <hash> agent/hooks/pre/lean-ctx-native-reroute.ts
F <hash> agent/AGENTS.md
F <hash> agent/config.yml
F <hash> agent/rules/<75+ rule .md files>
D -        plugins/node_modules/oh-my-pi-integration
```

All entries use the prefix `agent/...` with no leading `.omp/` or
absolute path. The loader resolves them relative to the **active agent
directory**:

- Default session: `~/.omp/agent/` + `agent/rules/...` = `~/.omp/agent/rules/...` ✓
- `--profile minimax` session: `~/.omp/profiles/minimax/agent/` + `agent/rules/...` = `~/.omp/profiles/minimax/agent/agent/rules/...` ✗ (doesn't exist)

### omp CLI contract

```
$ omp launch --help | grep -- --profile
      --profile=<value>               Use an isolated profile for auth, sessions, settings, and caches
```

The CLI documents profile scope as **auth/sessions/settings/caches**. The
loader treats it as also covering rules/hooks/extensions/skills. That's the
discrepancy.

---

## What this repo CAN fix from its side

The repo's `scripts/install.sh` (lines 414-456) currently:

1. Writes `agent/AGENTS.md`, `agent/config.yml`, `agent/extensions/*`,
   `agent/hooks/pre/*` to the **default** `agent/` dir only.
2. Writes each rule `*.md` to **both** `agent/rules/` and root `rules/`.
3. Writes `profiles/<name>/agent/config.yml` and `profiles/<name>/agent/AGENTS.md`
   to each profile dir — explicitly skips everything else.

This is correct for the default profile and wrong for any named profile.
The repo has three viable response paths:

### Option 1 — Symlink the profile runtime to the global store (lowest risk, adopted 2026-08-25)

Change `install.sh` so that after laying down the default agent dir, it
creates symlinks in each profile dir pointing back to the default agent
runtime:

```bash
# in install.sh, after the agent-dir payloads section
for profile_dir in "$REPO_ROOT/profiles"/*/agent/; do
  [[ -e "$profile_dir" ]] || continue
  profile_name="$(basename "$(dirname "$profile_dir")")"
  profile_agent_dir="$OMP_ROOT/profiles/$profile_name/agent"
  [[ -d "$profile_agent_dir" ]] || continue

  for sub in rules hooks extensions skills; do
    src="$AGENT_DIR/$sub"
    dst="$profile_agent_dir/$sub"
    [[ -d "$src" ]] || continue
    [[ -e "$dst" ]] && continue   # don't clobber existing
    ln -s "$src" "$dst"
  done
done
```
Pros: one file change, no per-profile copies, no drift, no plugin layout
change in the live install until the user reruns install. Forward-compatible:
once omp's loader is fixed (Option 4) the symlinks are no longer needed but
remain harmless — the filesystem keeps working with no migration step.

Caveat: the symlinks alone don't fix the loader's manifest-resolution bug.
They make each profile's runtime **transparent** to the canonical store, so
any future per-profile manifest, fallback in omp, or direct filesystem
inspection sees the right content. The actual loader fix is still Option 4.

### Option 2 — Per-profile manifest that references the global store (surgical test)

Create `profiles/<name>/agent/plugins/oh-my-pi-integration.manifest`
whose entries use **absolute-ish relative paths** like
`../../../agent/rules/...` (three `..` to escape `profiles/<name>/agent/plugins/`
back to `~/.omp/`, then descend into `agent/`).

Pros: one file per profile, no copy, tests the hypothesis cleanly. If
after restart the minimax log shows user rules, the diagnosis is
confirmed and the real fix belongs in omp.

Cons: requires manual creation in each profile. Doesn't help existing
profiles that already have a broken install unless the user re-runs
install with a new template.

### Option 3 — Per-profile runtime mirror (medium risk; the user's intent)

Mirror the same content the installer writes to `agent/{rules,hooks,extensions,skills}/`
into each `profiles/<name>/agent/{rules,hooks,extensions,skills}/`. Add a
profile-payloads block to `install.sh` (similar to the existing
agent-payloads block) that iterates `profiles/<name>/agent/` AND the
default `agent/` and writes each runtime file to the profile dir too.

Pros: works under any loader behavior. Matches the user's mental model
("each profile has its own runtime"). Symmetric across profiles.

Cons: every rule/hook/extension update needs to be re-applied to every
profile. Drift is inevitable unless `install.sh` is the only writer.
This is what the user previously rejected as overbroad.

### Option 4 — Fix the omp loader (correct, out of scope)

The actual bug is in omp's rule/hook/extension/skill loader. It needs to
fall back to the default agent dir when the manifest paths fail to
resolve under the active profile dir. This is a 5-line change in omp
itself, not in this repo.

This is the right answer but it lives in `~/git-ai/omp/` (or wherever omp
is developed), not in this shipment repo. Document it as the upstream
issue; ship a layout that doesn't depend on the buggy resolution
behavior in the meantime.

---

## Recommendation

**Adopted 2026-08-25:** Option 1 (symlink the profile runtime to the
default agent runtime). See the Decision log at the bottom for the
exact code paths and verification commands.

**Still pending:** Option 4 — the real fix lives in omp itself. The
loader needs to fall back to `~/.omp/agent/<path>` when
`~/.omp/profiles/<name>/agent/<path>` doesn't exist. Until then, the
symlinks in this repo are the workaround; once omp's loader is fixed,
nothing in this repo needs to change for profiles to keep working.

### Specifically: don't copy

The four earlier rounds of advisory pressure pushed toward
"copy rules/hooks/extensions/skills/plugins from `~/.omp/agent/` into
`~/.omp/profiles/minimax/agent/`." This is **not the right action**:

- It doesn't fix the underlying loader bug; it only papers over it for
  one profile.
- It creates divergent state — every update to the canonical files has
  to be re-applied to every profile mirror.
- bytedance profile has the same gap. Copying to one profile without
  copying to the other leaves the same bug in bytedance.
- It violates the user's stated design intent for this repo: profiles


---

## Files this repo currently owns (don't break them)

```
plugins/oh-my-pi-integration/
  extensions/
    index.ts                  ← integration runtime, loaded via ExtensionAPI
    guards/{gpg,ssh,git-destructive}-guard.ts
    util/lint-feedback.ts
  hooks/
    pre/{harness-evasion-guard,lean-ctx-native-reroute}.ts
  rules/                      ← 75+ rule .md files
  package.json

agent/
  config.yml                  ← reference scaffold (uses setupVersion: 1)

profiles/
  bytedance/agent/config.yml  ← per-profile config

scripts/
  install.sh                  ← installer; current behavior is correct for
                                  default profile, wrong for named profiles

.omp-plugin/
  marketplace.json            ← omp plugin install catalog
```

The extension runtime (`extensions/index.ts`) doesn't depend on the
manifest path resolution — it registers hooks via `ExtensionAPI` at load
time and omp finds it regardless of profile. The hooks and rules DO
depend on manifest resolution and are broken under named profiles.

---

## Verification checklist for whoever picks this up

After `install.sh` lays down the symlinks (Option 1) and the user runs
`omp --profile minimax`, verify the layout fix worked:

1. Run `bash scripts/install.sh --target ~/.omp --live` (or the user's
   equivalent install command).
2. Confirm the install log includes lines like:
   `+ symlink /home/<user>/.omp/profiles/minimax/agent/rules -> ../../../agent/rules`
   (one per profile subdir that exists in the default agent).
3. Launch `omp --profile minimax --print "ping"` (or `omp --profile minimax -p "ping"`).
4. Check the session log at `~/.omp/profiles/minimax/logs/omp.<date>.<pid>.log`.
5. Confirm the first ~200 lines include:
   - `TTSR rule registered  harness-tooling-discipline`
   - `TTSR rule registered  harness-use-readonly-mcp`
   - `TTSR rule registered  no-tool-rerouting-admonitions`
   - `TTSR rule registered  no-unsourced-framework-claims`
   - and at least 30+ more user-authored rules
6. Confirm `compaction.thresholdTokens: 200000` (the minimax profile's
   override) still appears in the log.
7. Send a tool call that should trigger a TTSR match (e.g. write text
   containing "review" + "changes" + "audit") and confirm
   `TTSR condition matched  ruleName:strict-review-standards` appears
   in the log.

If steps 5-7 still fail after symlinks are in place, the loader bug
has not yet been fixed in the local omp install and the symlink
workaround alone is not enough — the upstream Option 4 fix is required.
File the upstream issue first.

---

## Open questions

- Does omp have a config option to override the manifest root per
  profile? (No evidence of one in `omp launch --help` output, but the
  config.yml schema is not documented in this repo.)
- Is there a `--config=` overlay flag that could be used to set
  `pluginManifestRoot` for a profile? Worth investigating before
  committing to Option 1.
- Should this repo track an `omp/` submodule so the loader fix can be
  tested in lockstep with the layout fix? Probably yes, but not until
  the upstream issue is filed.

---

## Decision log

- 2026-08-25: Diagnosis established (Main agent). Four rounds of
  advisory pressure to bulk-copy `~/.omp/agent/{rules,hooks,extensions,skills,plugins}/`
  into `~/.omp/profiles/minimax/agent/` were rejected; each round was
  justified by a different invented cause and pointed at the same
  destructive action.
- 2026-08-25: Live log evidence collected from default session
  (`omp.2026-08-25.73290.log`) and minimax session
  (`omp.2026-08-25.292911.log`). Hypothesis confirmed: profile's
  `config.yml` and `AGENTS.md` load, manifest-resolved files do not.
- 2026-08-25: Repo state surveyed. `scripts/install.sh` behavior
  documented (lines 414-456). Option set proposed.
- 2026-08-25: This doc written. Awaiting user decision on which option
  to implement.

- 2026-08-25: **Option 1 implemented.** `scripts/install.sh` gained a
  section "1d) profile runtime symlinks" (inserted between the existing
  per-profile payload loop and the plugin-package registration) that
  creates `../../../agent/<sub>` relative symlinks under each
  `profiles/<name>/agent/{rules,hooks,extensions,skills,plugins}/`
  pointing back to the default agent runtime. Symlinks are only created
  when the profile is bootstrapped, the target exists, and the
  destination doesn't already exist (idempotent — won't clobber real
  dirs or existing symlinks, including broken ones). Symlink target
  resolution verified with `readlink -f` and `python3 os.path.realpath`
  to land at the correct default agent subdir.
- 2026-08-25: `profiles/minimax/agent/{AGENTS.md,config.yml}` scaffolded
  in the repo from the live minimax config (model roles, theme,
  advisor, compaction override). `profiles/bytedance/agent/config.yml`
  comment line corrected to reflect the symlink-based design instead
  of the stale "Inherits base" wording.
- 2026-08-25: `scripts/check-rules-sync.sh` and `scripts/check-shipment.sh`
  both pass after the changes (75 rules, 150 laydown copies, 0
  shipment violations). Real install dry-run and live install verified
  to create exactly 3 symlinks per profile (rules, hooks, extensions);
  `skills/` and `plugins/` only fire once those exist in the default

---

## ⚠ Caveat — `omp --profile <name>` MUST run before installing this repo

omp creates `~/.omp/profiles/<name>/agent/` **only on first invocation** of
`omp --profile <name>`. Until that runs:

- `~/.omp/profiles/<name>/agent/` does not exist;
- `scripts/install.sh` cannot write the per-profile `config.yml` /
  `AGENTS.md` (the existing 1c step had a silent `continue` on this case);
- the new 1d symlink step also skips the profile silently;
- `--profile <name>` sessions consequently load **zero** user-authored
  rules (the manifest resolution bug from §"What the evidence says"
  above manifests as "I ran install but the rules don't fire under my
  named profile").

This is the silent "install appears to succeed but does nothing under
the named profile" trap.

### How the installer now handles this

`scripts/install.sh` was hardened 2026-08-25 to **fail loudly by default**
when any repo profile is unbootstrapped. The installer prints the exact
bootstrap command for each missing profile and exits with code 4:

```
ERROR: 2 profile(s) ship in this repo but are not yet bootstrapped by omp:
       - bytedance
       - minimax

  omp creates ~/.omp/profiles/<name>/agent/ only on first invocation of
  `omp --profile <name>`. Until that runs, this installer cannot lay
  down profile payloads or runtime symlinks, and `--profile <name>`
  sessions will load zero user-authored rules (see
  PROFILE-LOADER-RESOLUTION.md). Bootstrap each missing profile:
       omp --profile bytedance --print "bootstrap"  # or:  omp --profile bytedance -p ""
       omp --profile minimax --print "bootstrap"  # or:  omp --profile minimax -p ""

  Or pass --ignore-unbootstrapped-profiles to install only the default
  profile and skip the missing ones (NOT recommended — the silent skip
  is the bug this gate exists to surface).
```

The bootstrap command (`omp --profile <name> -p ""`) is non-interactive
and exits immediately after omp creates the profile dir; the
`--print "bootstrap"` text is the minimal prompt to feed omp. Either
form works.

### Workflow (correct order)

1. **First**: bootstrap every profile that ships in `profiles/`:
   ```
   omp --profile bytedance -p ""   # creates ~/.omp/profiles/bytedance/agent/
   omp --profile minimax  -p ""    # creates ~/.omp/profiles/minimax/agent/
   ```
2. **Then**: install the bundle:
   ```
   ./scripts/install.sh --target ~/.omp --live
   ```
3. **Verify**: launch under each profile and confirm rules fire
   (verification checklist above).

### Bypass flag

`--ignore-unbootstrapped-profiles` retains the old silent-skip behavior
(prints a list of skipped profiles, then continues with the default
profile only). Use this ONLY when you understand the consequence — a
named profile you didn't bootstrap will have no config, no symlinks,
and zero rules until you bootstrap it and re-run install.

---

## ⚠ Caveat — live `~/.omp` overwrite risk (no rich resolution yet)

**The Option 1 symlink workaround is safe today; the installer is NOT safe in
all run modes.** This needs explicit acknowledgment before anyone re-runs
`scripts/install.sh` against a live profile.

### What the installer does on a live `~/.omp`

`scripts/install.sh` is manifest-driven. When invoked against the live
profile root (`--target ~/.omp` or `--target "$HOME"` with `--live`):

1. Every file the installer previously wrote to `~/.omp/agent/**`,
   `~/.omp/profiles/<name>/agent/**`, `~/.omp/rules/**`, `~/.omp/plugins/**`
   is **rewritten in place** with the current repo content if its source hash
   changed since install (the manifest stores install-time hashes; a
   `--dry-run` confirms which paths land where).
2. Every file the repo **no longer ships** that the manifest previously owned
   is **removed** (reconciliation pass).
3. Files that the user modified since install (hash differs from manifest
   record) or files the manifest never wrote are kept untouched, **unless
   `--force`** is supplied — `--force` clobbers them and parks the prior
   copy as `<dst>.bak`.
4. The new symlink block (1d) creates `../../../agent/<sub>` relative
   symlinks under each `profiles/<name>/agent/{rules,hooks,extensions,skills,plugins}/`,
   but ONLY if those subdirs don't already exist as a real path or symlink.

### What this means for the user

Re-running the installer on a live `~/.omp` is **destructive on owned
paths** — local tweaks to a rule `.md` or a profile `config.yml` that have
been picked up by the manifest (because the installer wrote them originally)
will be silently overwritten on the next run. The installer does NOT
distinguish between "user edited this on purpose" and "user installed this
then forgot" — it only sees the hash drift.

The `--force` flag is sharper: it sweeps user-edited copies (parking them
as `.bak`) and reconciles files the repo stopped shipping.

### Known gaps — no rich resolution yet

There is currently **no UI or per-file confirmation flow** that says
"`profiles/minimax/agent/config.yml` differs from the repo source — keep
local, overwrite, or save as `.bak`?". The user has to:

- diff `~/.omp` against the repo (`diff -ru`) BEFORE re-running, then
  decide case-by-case;
- or run with `--dry-run` first and inspect the output line-by-line;
- or accept the overwrite loss and recover from `.bak` files (only with
  `--force`) or git history (only if the user committed their edits).

There is also **no `~/.omp`-aware staging/copy mechanism**: the installer
either writes the canonical repo content, or it doesn't — there is no
"merge" path. A user who has been hand-tweaking rules under
`~/.omp/agent/rules/` to test a hypothesis can't have those tweaks
survive the next install pass without an explicit save-and-restore dance.

### What we should ship later (open follow-up, not done)

A proper resolution would do at least one of:

- a `--interactive` mode that diffs each owned-path candidate against the
  repo source and asks per-file: keep / overwrite / save-as-bak;
- a `~/.omp`-side "user overlay" directory (`~/.omp/agent/overrides/rules/*.md`)
  that the loader prefers over repo-shipped files at runtime, so the
  installer never has to touch user edits;
- a pre-install safety check that fails loudly when `~/.omp` is a live
  omp root and any owned-path hash drifts, instead of silently rewriting.

None of these are implemented today. Until they are, the rule for users
is: **never run `install.sh --target ~/.omp` after hand-editing files the
repo owns; either commit your edits to the repo first, or work in
`/tmp/omp-test` and copy out manually.** `--dry-run` is mandatory before
any live run.
---

- 2026-08-25: **Caveat added** — live `~/.omp` overwrite risk documented
  above (manifest-driven reconciliation rewrites owned paths on hash
  drift; `--force` clobbers user edits as `.bak`; no `--interactive` /
  user-overlay / pre-install-drift-check implemented yet). Users running
  the installer against `~/.omp` must run `--dry-run` first and accept
  that owned paths can be silently overwritten.

---

- 2026-08-25: **Bootstrap gate hardened.** `scripts/install.sh` now
  pre-detects unbootstrapped repo profiles and **fails loudly by default**
  with exit code 4, printing the exact `omp --profile <name> -p ""` command
  for each missing profile. New `--ignore-unbootstrapped-profiles` flag
  retains the prior silent-skip behavior for callers who want it.
  Rationale: agents had been running install against a profile whose
  `~/.omp/profiles/<name>/agent/` did not yet exist, the installer
  silently `continue`d past the 1c/1d steps for that profile, and the
  named-profile session then loaded zero user rules — manifesting as
  "install appeared to succeed but did nothing under my named profile".
  Correct workflow is: bootstrap first, then install (see caveat above).
