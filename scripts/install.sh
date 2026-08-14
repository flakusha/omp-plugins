#!/usr/bin/env bash
# install.sh — Install the oh-my-pi integration bundle into a target omp
# profile root.
#
# Usage:
#   ./scripts/install.sh [--target DIR] [--force] [--dry-run] [--no-plugin]
#
#   --target DIR   Where to install. Default: /tmp/omp-test.
#                  Equivalent to setting PREFIX=DIR.
#   --force        Overwrite existing files in the target (default: skip/clobber
#                  only bundle-owned paths, never user data).
#   --dry-run      Print what would be written without touching the filesystem.
#   --no-plugin    Skip registering the plugin package (agent-dir payloads only).
#
# Laydown (relative to TARGET):
#   TARGET/.omp/agent/config.yml                       agent config scaffold
#   TARGET/.omp/agent/extensions/index.ts              integration extension
#   TARGET/.omp/agent/extensions/guards/{gpg,ssh}-guard.ts
#   TARGET/.omp/agent/hooks/pre/lean-ctx-native-reroute.ts
#   TARGET/.omp/agent/skills/loop-lore-world-timeline/SKILL.md
#   TARGET/.omp/plugins/node_modules/oh-my-pi-integration/   plugin package
#   TARGET/.omp/plugins/omp-plugins.lock.json                enablement state
#
# Runtime state (databases, sessions, caches) is NEVER copied.

set -euo pipefail

# ---- resolve repo root (this script lives in <root>/scripts) ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---- defaults ----
TARGET="${PREFIX:-/tmp/omp-test}"
FORCE=0
DRY_RUN=0
NO_PLUGIN=0

# ---- arg parsing ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:?--target requires a path}"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-plugin) NO_PLUGIN=1; shift ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

TARGET="$(realpath -m "$TARGET")"
AGENT_DIR="$TARGET/.omp/agent"
PLUGIN_DIR="$TARGET/.omp/plugins"
PKG_NAME="oh-my-pi-integration"
PLUGIN_SRC="$REPO_ROOT/plugins/$PKG_NAME"

echo "==> oh-my-pi integration bundle installer"
echo "    target : $TARGET"
echo "    source : $REPO_ROOT"

# ---- guard: refuse to run inside a real user home / profile root ----
if [[ "$TARGET" == "$HOME" || "$TARGET" == "$HOME/.omp" || "$TARGET" == "$HOME/.omp/"* ]] \
   && [[ "$TARGET" != "$HOME/.omp-test/"* ]]; then
  echo "ERROR: refusing to install over your live omp profile ($TARGET)." >&2
  echo "       Use an isolated target, e.g.  --target /tmp/omp-test" >&2
  exit 3
fi

if [[ ! -d "$PLUGIN_SRC" ]]; then
  echo "ERROR: plugin source missing: $PLUGIN_SRC" >&2
  exit 1
fi

# ---- helpers ----
warn() { echo "  ! $*" >&2; }

# copies a file; skips (with notice) when the destination exists and --force off
place_file() {
  local src="$1" dst="$2"
  if [[ -e "$dst" && "$FORCE" -eq 0 ]]; then
    warn "exists, keeping: $dst"
    return
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  + $dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "  + $dst"
}

# ---- 1) agent-dir payloads (discovered directly by omp) ----
echo "==> agent profile payloads"
place_file "$REPO_ROOT/agent/config.yml"                     "$AGENT_DIR/config.yml"
place_file "$PLUGIN_SRC/extensions/index.ts"                 "$AGENT_DIR/extensions/index.ts"
place_file "$PLUGIN_SRC/extensions/guards/gpg-guard.ts"      "$AGENT_DIR/extensions/guards/gpg-guard.ts"
place_file "$PLUGIN_SRC/extensions/guards/ssh-guard.ts"      "$AGENT_DIR/extensions/guards/ssh-guard.ts"
place_file "$PLUGIN_SRC/hooks/pre/lean-ctx-native-reroute.ts" "$AGENT_DIR/hooks/pre/lean-ctx-native-reroute.ts"
place_file "$PLUGIN_SRC/skills/loop-lore-world-timeline/SKILL.md" \
                                                             "$AGENT_DIR/skills/loop-lore-world-timeline/SKILL.md"

# ---- 2) plugin-package registration (marketplace / `omp plugin` discovery) ----
if [[ "$NO_PLUGIN" -eq 0 ]]; then
  echo "==> plugin package registration"
  PKG_DST="$PLUGIN_DIR/node_modules/$PKG_NAME"
  if [[ -d "$PKG_DST" && "$FORCE" -eq 0 ]]; then
    warn "plugin package exists (skip --force to keep): $PKG_DST"
  else
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "  + $PKG_DST/  (copy of $PLUGIN_SRC)"
    else
      mkdir -p "$PLUGIN_DIR/node_modules"
      rm -rf "$PKG_DST"
      cp -R "$PLUGIN_SRC" "$PKG_DST"
      chmod -R u+w "$PKG_DST"
      echo "  + $PKG_DST/  (copy of $PLUGIN_SRC)"
    fi
  fi

  LOCK="$PLUGIN_DIR/omp-plugins.lock.json"
  if [[ -e "$LOCK" && "$FORCE" -eq 0 ]]; then
    warn "existing plugin lockfile kept: $LOCK (use --force to re-enable)"
  else
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "  + $LOCK  ({\"version\":1,\"plugins\":{\"$PKG_NAME\":{\"enabled\":true}}})"
    else
      mkdir -p "$PLUGIN_DIR"
      python3 - "$LOCK" "$PKG_NAME" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path))
except (OSError, ValueError):
    data = {"version": 1, "plugins": {}, "settings": {}}
data.setdefault("plugins", {})[name] = {"enabled": True, "enabledFeatures": None}
data.setdefault("settings", {}).setdefault(name, {})
json.dump(data, open(path, "w"), indent=2)
print_struct = data["plugins"][name]
print(f"  + {path}  ({name} enabled)")
PY
    fi
  fi
fi

# ---- 3) summary ----
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> dry-run complete (no files written)"
else
  echo "==> installed to $TARGET"
  echo
  echo "Next steps:"
  echo "  omp --profile test      # or point omp at $TARGET/.omp/agent"
  echo "  export PI_INTEGRATION_RETRIEVE=1   # enable engram turn-start retrieval"
  echo "  export PI_INTEGRATION_DISABLE=1    # disable the whole extension"
fi