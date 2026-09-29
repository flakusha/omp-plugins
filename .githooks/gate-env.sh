#!/bin/sh
# Gate environment for the pre-commit hook — sourced, not executed.
#
# Two unrelated families are removed, for two unrelated reasons:
#
#  1. GIT_* — git exports these into a hook. The test suite spawns fixture git
#     repos under /tmp; inheriting GIT_DIR/GIT_INDEX_FILE makes those fixtures
#     operate on THIS repo instead of themselves. Named explicitly because a
#     blanket "strip every GIT_ var" is a behavior change nobody asked for.
#  2. Agent-harness session vars (OMP_/PI_/ENGRAM_/MNEMO_*) — the hook runs
#     inside a live agent session, so a gate (or a tool it spawns) that honours a
#     session var takes a path a human shell never takes. The verdict would then
#     be the session's verdict, not the one CI produces. Harness vars are
#     prefixes, not fixed names, so they are stripped by scanning the live
#     environment: a NEW OMP_/PI_ var is covered without editing a list here.
#
# POSIX sh only — the hook is #!/bin/sh (no arrays, [[ ]] or process
# substitution). Sourced from .githooks/pre-commit; this file is the single
# definition of the stripped set.

GATE_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR -u GIT_QUARANTINE_PATH"

# One -u per currently-exported harness var, so a NEW OMP_/PI_ var is covered
# without anyone editing a list. The grep requires NAME= with an identifier
# tail: a multi-line value spills continuation lines into `env` output, and a
# continuation line carrying spaces would otherwise split into a stray word
# that env would read as the command. Names are cut before the first `=` so
# values never reach the word split.
GATE_ENV="$GATE_ENV $(env | grep -E '^(OMP_|PI_|ENGRAM_|MNEMO_)[A-Za-z0-9_]*=' | cut -d= -f1 | sed 's/^/-u /' | tr '\n' ' ' || true)"
