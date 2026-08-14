#!/usr/bin/env bash
# check-no-console.sh — enforce rule `use-configured-loggers`: no bare
# console.* calls in shipped TS. Biome 2.5.8 dropped noConsoleLog, so this
# repo-level gate stands in: console.log/debug/info/warn/error all bypass the
# application's configured logger (no level/format/sink/redaction), which the
# rule forbids.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bad="$(
  grep -rn --include='*.ts' -E 'console\.(log|debug|info|warn|error)[[:space:]]*\(' "$REPO_ROOT/plugins" || true
)"
if [[ -n "$bad" ]]; then
  echo "ERROR: bare console.* found — use the application's configured logger (rule use-configured-loggers):" >&2
  echo "$bad" >&2
  exit 1
fi

echo "==> no bare console.* in plugins (use-configured-loggers enforced)"
