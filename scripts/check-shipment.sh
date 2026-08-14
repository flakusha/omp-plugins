#!/usr/bin/env bash
# check-shipment.sh — guard against shipping dev-only / non-runtime files into a
# profile. omp walks the plugin package tree and tries to load any *.ts it finds
# (hooks/pre, top-level agent/extensions). Shipping the unit tests (`__tests__/`)
# or leftover `.bak`/`.original` files breaks the profile:
#   * a test loaded as a hook/extension → "Cannot use describe outside of the
#     test runner";
#   * a helper .ts at the top of agent/extensions (non-factory) → "Extension
#     does not export a valid factory function".
#
# This performs a real (non dry-run) install into an isolated temp target and
# asserts the shipped tree contains no `__tests__` dirs, no `.bak`/`.original`
# files, and that the only top-level .ts under .omp/agent/extensions/ is the
# index.ts factory. Run as part of `bun run verify` (check:ship).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tmp="$(mktemp -d --suffix=-ship-check)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

fail() { echo "ERROR: $*" >&2; exit 1; }

echo "==> shipment check (install into $tmp)"
"$REPO_ROOT/scripts/install.sh" --target "$tmp" >/dev/null

inst_pkg="$tmp/.omp/plugins/node_modules/oh-my-pi-integration"
inst_ext="$tmp/.omp/agent/extensions"

# 1) no unit-test trees may ship in the plugin package or the agent payloads
n_tests="$(find "$tmp/.omp" -type d -name "__tests__" | wc -l)"
echo "    __tests__ dirs shipped: $n_tests"
[[ "$n_tests" -eq 0 ]] || fail "dev unit tests shipped into profile ($n_tests __tests__ dirs)"
[[ -e "$inst_pkg" ]] || fail "plugin package not installed at $inst_pkg"

# 2) no leftover .bak / .original files ship in the package
n_bak="$(find "$inst_pkg" -type f \( -name "*.bak" -o -name "*.original" \) | wc -l)"
echo "    .bak/.original shipped: $n_bak"
[[ "$n_bak" -eq 0 ]] || fail "backup/leftover files shipped into plugin package"

# 3) only the real extension factory sits at the top of agent/extensions
tops="$(find "$inst_ext" -maxdepth 1 -type f -name "*.ts" -printf '%f\n' | sort)"
echo "    top-level agent/extensions .ts: ${tops:-<none>}"
[[ "$tops" == "index.ts" ]] || fail "non-factory .ts at top of agent/extensions (would fail to load): $tops"

echo "==> shipment check OK"
