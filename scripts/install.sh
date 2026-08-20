#!/usr/bin/env bash
# install.sh — Install the oh-my-pi integration bundle into a target omp
# profile root.
#
# Usage:
#   ./scripts/install.sh [--target DIR] [--force] [--dry-run] [--no-plugin] [--live]
#
#   --target DIR   Where to install. Default: /tmp/omp-test.
#                  Equivalent to setting PREFIX=DIR.
#                  TARGET is a host root that owns an .omp profile; if TARGET
#                  itself is a .omp root (e.g. ~/.omp) the bundle is laid down
#                  directly under it without nesting a second .omp.
#   --force        Overwrite locally-modified or untracked files too
#                  (previous copy kept as <dst>.bak). Default: update only
#                  installer-owned files, keep anything else with a notice.
#   --dry-run      Print what would be written/updated/removed without
#                  touching the filesystem.
#   --no-plugin    Skip registering the plugin package (agent-dir payloads
#                  and rules only).
#   --live         Allow updating a live omp profile under $HOME directly
#                  (e.g. --target ~/.omp or --target "$HOME"). Refused by
#                  default to protect the live profile.
#
# Laydown (relative to TARGET):
#   TARGET/.omp/agent/AGENTS.md                      omp-specific global agent rules
#   TARGET/.omp/agent/config.yml                       agent config scaffold
#   TARGET/.omp/agent/extensions/index.ts              integration extension
#   TARGET/.omp/agent/extensions/guards/{gpg,ssh}-guard.ts
#   TARGET/.omp/agent/hooks/pre/lean-ctx-native-reroute.ts
#   TARGET/.omp/agent/hooks/pre/harness-evasion-guard.ts
#   TARGET/.omp/agent/rules/*.md                       universal project rules (agent-scoped)
#   TARGET/.omp/rules/*.md                            universal project rules (root level, picked up by omp directly)
#   TARGET/.omp/profiles/<name>/agent/config.yml      per-profile config (from repo profiles/<name>/agent/)
#   TARGET/.omp/profiles/<name>/agent/AGENTS.md       per-profile agent rules (from repo profiles/<name>/agent/)
#   TARGET/.omp/plugins/node_modules/oh-my-pi-integration/   plugin package
#   TARGET/.omp/plugins/omp-plugins.lock.json                enablement state
#   TARGET/.omp/plugins/oh-my-pi-integration.manifest        ownership ledger
# Update semantics (manifest-driven):
#   The manifest records every file/dir this installer wrote, with the
#   source hash at install time. On re-run:
#     * files we own (destination hash unchanged) are updated in place —
#       rules added, changed, or renamed synchronize WITHOUT --force;
#     * files we own but that no longer ship are removed (reconciliation);
#     * files the user modified since install (hash differs), or files we
#       never wrote, are kept with a notice — never clobbered without
#       --force;
#     * --force additionally overwrites locally-modified/untracked files,
#       keeping the previous copy as <dst>.bak.
#   Symlinked destinations/parents are never followed: writes and removals
#   are refused (or the symlink removed under --force), and every touched
#   path is realpath-checked to stay inside TARGET.
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
LIVE=0

# ---- arg parsing ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:?--target requires a path}"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-plugin) NO_PLUGIN=1; shift ;;
    --live)   LIVE=1; shift ;;
    -h|--help)
      sed -n '2,58p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

TARGET="$(realpath -m "$TARGET")"

# TARGET is a "host root" that owns an omp profile. When TARGET itself is a
# profile root (basename ".omp", e.g. ~/.omp), lay the bundle down directly
# under it instead of nesting a second ".omp" (so rules land at ~/.omp/agent).
if [[ "$(basename "$TARGET")" == ".omp" ]]; then
  OMP_ROOT="$TARGET"
  RLOB=""                    # rel-prefix: profile root matches TARGET
else
  OMP_ROOT="$TARGET/.omp"
  RLOB=".omp/"               # rel-prefix: profile root is TARGET/.omp
fi
AGENT_DIR="$OMP_ROOT/agent"
RULES_DIR="$AGENT_DIR/rules"        # agent-scoped rules (backward-compat)
ROOT_RULES_DIR="$OMP_ROOT/rules"     # root-level rules (picked up by omp directly)
PLUGIN_DIR="$OMP_ROOT/plugins"
PKG_NAME="oh-my-pi-integration"
PLUGIN_SRC="$REPO_ROOT/plugins/$PKG_NAME"
MANIFEST="$PLUGIN_DIR/$PKG_NAME.manifest"
LOCK="$PLUGIN_DIR/omp-plugins.lock.json"

echo "==> oh-my-pi integration bundle installer"
echo "    target : $TARGET"
echo "    source : $REPO_ROOT"

# ---- guard: refuse to run inside a real user home / profile root ----
# Unblocked only by an explicit --live (deliberate direct update of ~/.omp).
if ( [[ "$TARGET" == "$HOME" || "$TARGET" == "$HOME/.omp" || "$TARGET" == "$HOME/.omp/"* ]] \
     && [[ "$TARGET" != "$HOME/.omp-test/"* ]] ) && [[ "$LIVE" -eq 0 ]]; then
  echo "ERROR: refusing to install over your live omp profile ($TARGET)." >&2
  echo "       Pass --live to update your live profile directly, or use an" >&2
  echo "       isolated target, e.g.  --target /tmp/omp-test" >&2
  exit 3
fi
if [[ "$LIVE" -eq 1 ]] && ( [[ "$TARGET" == "$HOME" || "$TARGET" == "$HOME/.omp"* ]] ); then
  echo "    [live] updating your live profile under $HOME/.omp"
fi

# refuse nonsense / system roots outright
if [[ -z "$TARGET" || "$TARGET" == "/" || "$TARGET" == "/root" || "$TARGET" == "/root/"* ]]; then
  echo "ERROR: refusing dangerous target: $TARGET" >&2
  exit 3
fi

if [[ ! -d "$PLUGIN_SRC" ]]; then
  echo "ERROR: plugin source missing: $PLUGIN_SRC" >&2
  exit 1
fi

# ---- helpers ----
warn() { echo "  ! $*" >&2; }

INSTALLED=0
UPDATED=0
KEPT=0
REMOVED=0
UNCHANGED=0

# sha256 of a regular file, or empty when missing/symlink (symlinks are never
# hashed — a symlinked destination counts as "not ours")
file_sha() {
  local p="$1"
  if [[ -f "$p" && ! -L "$p" ]]; then
    sha256sum "$p" 2>/dev/null | cut -d' ' -f1 || true
  else
    echo ""
  fi
}

# ---- ownership ledger (manifest) ----
declare -A MAN_SHA MAN_DIR SHIP_SHA SHIP_DIR

manifest_load() {
  [[ -f "$MANIFEST" ]] || return 0
  local type sha rel
  while read -r type sha rel; do
    [[ -z "$rel" ]] && continue
    if [[ "$type" == "F" ]]; then
      MAN_SHA["$rel"]="$sha"
    elif [[ "$type" == "D" ]]; then
      MAN_DIR["$rel"]=1
    fi
  done < "$MANIFEST"
}

manifest_save() {
  [[ "$DRY_RUN" -eq 1 ]] && return
  mkdir -p "$PLUGIN_DIR"
  local tmp="$MANIFEST.tmp" rel
  : > "$tmp"
  for rel in "${!MAN_SHA[@]}"; do
    printf 'F %s %s\n' "${MAN_SHA[$rel]}" "$rel" >> "$tmp"
  done
  for rel in "${!MAN_DIR[@]}"; do
    printf 'D - %s\n' "$rel" >> "$tmp"
  done
  sort -k3 "$tmp" -o "$tmp"
  mv "$tmp" "$MANIFEST"
}

# ---- path-safety: never write or remove outside TARGET, never follow
# ---- symlinks out of it ----
in_realm() {
  local rp
  rp="$(realpath -m "$1")"
  [[ "$rp" == "$TARGET" || "$rp" == "$TARGET"/* ]]
}

# mkdir -p dirname(dst), refusing symlinked / out-of-realm parents
ensure_parent() {
  local dst="$1" parent
  parent="$(dirname "$dst")"
  if [[ -L "$parent" ]]; then
    if [[ "$FORCE" -eq 1 ]]; then
      rm -f "$parent"
    else
      warn "symlinked parent, keeping: ${dst#"$TARGET"/}"
      return 1
    fi
  fi
  if ! in_realm "$parent"; then
    warn "parent outside target, keeping: ${dst#"$TARGET"/}"
    return 1
  fi
  [[ "$DRY_RUN" -eq 1 ]] || mkdir -p "$parent"
}

# write a bundle file (install/update/force-overwrite). Returns 0 written,
# 1 kept. Caller is responsible for manifest bookkeeping.
do_write() {
  local src="$1" dst="$2" rel="$3" action="$4"
  if [[ -L "$dst" ]]; then
    if [[ "$FORCE" -eq 1 ]]; then
      rm -f "$dst"
    else
      warn "symlinked dst, keeping: $rel"
      return 1
    fi
  fi
  ensure_parent "$dst" || return 1
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  + $rel ($action)"
    return 0
  fi
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    if [[ -d "$dst" ]]; then
      rm -rf "$dst"
    else
      cp -p "$dst" "$dst.bak" 2>/dev/null || true
    fi
  fi
  cp "$src" "$dst"
  echo "  + $rel ($action)"
}

# replace a bundle-owned directory (plugin package): move-aside then copy.
do_replace_dir() {
  local src="$1" dst="$2" rel="$3" action="$4"
  if ! in_realm "$dst"; then
    warn "outside target, keeping: $rel"
    return 1
  fi
  ensure_parent "$dst" || return 1
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  + $rel/ ($action)"
    return 0
  fi
  if [[ -e "$dst" || -L "$dst" ]]; then
    rm -rf "$dst.bak" 2>/dev/null || true
    mv "$dst" "$dst.bak"
  fi
  cp -R "$src" "$dst"
  # Ship only runtime files: omp walks the package tree and tries to load any
  # *.ts it finds (hooks/pre, extensions top-level). Dev-only unit tests
  # (`__tests__/`) and leftover `.bak`/`.original` files must never ship —
  # loading a test as a hook/extension fails ("Cannot use describe outside of
  # the test runner") and a stray `.bak` pollutes the profile.
  find "$dst" -type d -name "__tests__" -prune -exec rm -rf {} + 2>/dev/null || true
  find "$dst" -type f \( -name "*.bak" -o -name "*.original" \) -delete 2>/dev/null || true
  chmod -R u+w "$dst"
  echo "  + $rel/ ($action)"
}

# ---- sync one bundle file ----
sync_file() {
  local src="$1" dst="$2" rel="$3"
  local src_sha cur_sha
  src_sha="$(file_sha "$src")"
  SHIP_SHA["$rel"]="$src_sha"

  if [[ ! -e "$dst" && ! -L "$dst" ]]; then
    if do_write "$src" "$dst" "$rel" "install"; then
      MAN_SHA["$rel"]="$src_sha"
      unset 'MAN_DIR[$rel]' 2>/dev/null || true
      INSTALLED=$((INSTALLED + 1))
    fi
    return
  fi

  # destination exists
  if [[ -n "${MAN_SHA[$rel]+x}" || -n "${MAN_DIR[$rel]+x}" ]]; then
    if [[ -n "${MAN_SHA[$rel]+x}" ]]; then
      cur_sha="$(file_sha "$dst")"
      if [[ "$cur_sha" == "${MAN_SHA[$rel]}" ]]; then
        # ours and unmodified
        if [[ "$src_sha" == "${MAN_SHA[$rel]}" ]]; then
          UNCHANGED=$((UNCHANGED + 1))
          echo "  = $rel (up to date)"
        elif do_write "$src" "$dst" "$rel" "update"; then
          MAN_SHA["$rel"]="$src_sha"
          UPDATED=$((UPDATED + 1))
        fi
      elif [[ "$FORCE" -eq 1 ]]; then
        warn "force-overwriting locally-modified: $rel"
        if do_write "$src" "$dst" "$rel" "force-overwrite"; then
          MAN_SHA["$rel"]="$src_sha"
          UPDATED=$((UPDATED + 1))
        fi
      else
        warn "modified locally, keeping: $rel"
        KEPT=$((KEPT + 1))
      fi
    else
      # manifest dir entry
      if do_replace_dir "$src" "$dst" "$rel" "update"; then
        UPDATED=$((UPDATED + 1))
      fi
    fi
  else
    # untracked at destination
    if [[ "$FORCE" -eq 1 ]]; then
      warn "force-overwriting untracked: $rel"
      if do_write "$src" "$dst" "$rel" "force-overwrite"; then
        MAN_SHA["$rel"]="$src_sha"
        UPDATED=$((UPDATED + 1))
      fi
    else
      warn "exists, keeping: $rel"
      KEPT=$((KEPT + 1))
    fi
  fi
}

# ---- sync one bundle-owned directory ----
sync_dir() {
  local src="$1" dst="$2" rel="$3"
  SHIP_DIR["$rel"]=1
  if [[ ! -e "$dst" && ! -L "$dst" ]]; then
    if do_replace_dir "$src" "$dst" "$rel" "install"; then
      MAN_DIR["$rel"]=1
      INSTALLED=$((INSTALLED + 1))
    fi
    return
  fi
  if [[ -n "${MAN_DIR[$rel]+x}" ]]; then
    do_replace_dir "$src" "$dst" "$rel" "update" && UPDATED=$((UPDATED + 1))
  elif [[ -e "$LOCK" ]]; then
    # migration: pre-manifest installs left the package dir plus lockfile;
    # the lockfile proves ownership, so adopt and update.
    warn "adopting pre-manifest install (lockfile present): $rel"
    if do_replace_dir "$src" "$dst" "$rel" "update"; then
      MAN_DIR["$rel"]=1
      UPDATED=$((UPDATED + 1))
    fi
  elif [[ "$FORCE" -eq 1 ]]; then
    warn "force-replacing untracked dir: $rel"
    if do_replace_dir "$src" "$dst" "$rel" "force-replace"; then
      MAN_DIR["$rel"]=1
      UPDATED=$((UPDATED + 1))
    fi
  else
    warn "exists, keeping: $rel/"
    KEPT=$((KEPT + 1))
  fi
}

# ---- reconciliation: remove files/dirs we own that no longer ship ----
reconcile() {
  local rel dst cur_sha
  for rel in "${!MAN_SHA[@]}"; do
    if [[ -n "${SHIP_SHA[$rel]+x}" ]]; then continue; fi
    dst="$TARGET/$rel"
    if [[ ! -e "$dst" && ! -L "$dst" ]]; then
      echo "  - $rel (already gone)"
      unset 'MAN_SHA[$rel]'
      continue
    fi
    cur_sha="$(file_sha "$dst")"
    if [[ "$cur_sha" == "${MAN_SHA[$rel]}" ]]; then
      if in_realm "$dst"; then
        if [[ "$DRY_RUN" -eq 1 ]]; then
          echo "  - $rel (no longer shipped)"
        else
          rm -f "$dst"
          echo "  - $rel (no longer shipped)"
        fi
        REMOVED=$((REMOVED + 1))
      else
        warn "outside target, keeping: $rel"
        KEPT=$((KEPT + 1))
      fi
    else
      warn "no longer shipped but modified locally, keeping: $rel"
      KEPT=$((KEPT + 1))
    fi
    unset 'MAN_SHA[$rel]'
  done
  for rel in "${!MAN_DIR[@]}"; do
    if [[ -n "${SHIP_DIR[$rel]+x}" ]]; then continue; fi
    if [[ "$NO_PLUGIN" -eq 1 ]]; then
      warn "plugin package not reconciled (--no-plugin): $rel"
      continue
    fi
    dst="$TARGET/$rel"
    if in_realm "$dst"; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "  - $rel/ (no longer shipped)"
      else
        rm -rf "$dst" 2>/dev/null || true
        echo "  - $rel/ (no longer shipped)"
      fi
      REMOVED=$((REMOVED + 1))
    else
      warn "outside target, keeping: $rel"
      KEPT=$((KEPT + 1))
    fi
    unset 'MAN_DIR[$rel]'
  done
}

manifest_load

# ---- 1) agent-dir payloads (discovered directly by omp) ----
echo "==> agent profile payloads"
sync_file "$REPO_ROOT/AGENTS.md" "$AGENT_DIR/AGENTS.md" "${RLOB}agent/AGENTS.md"
sync_file "$REPO_ROOT/agent/config.yml" "$AGENT_DIR/config.yml" "${RLOB}agent/config.yml"
sync_file "$PLUGIN_SRC/extensions/index.ts" "$AGENT_DIR/extensions/index.ts" "${RLOB}agent/extensions/index.ts"
sync_file "$PLUGIN_SRC/extensions/util/lint-feedback.ts" "$AGENT_DIR/extensions/util/lint-feedback.ts" "${RLOB}agent/extensions/util/lint-feedback.ts"
sync_file "$PLUGIN_SRC/extensions/guards/gpg-guard.ts" "$AGENT_DIR/extensions/guards/gpg-guard.ts" "${RLOB}agent/extensions/guards/gpg-guard.ts"
sync_file "$PLUGIN_SRC/extensions/guards/ssh-guard.ts" "$AGENT_DIR/extensions/guards/ssh-guard.ts" "${RLOB}agent/extensions/guards/ssh-guard.ts"
sync_file "$PLUGIN_SRC/extensions/guards/git-destructive-guard.ts" "$AGENT_DIR/extensions/guards/git-destructive-guard.ts" "${RLOB}agent/extensions/guards/git-destructive-guard.ts"
sync_file "$PLUGIN_SRC/hooks/pre/lean-ctx-native-reroute.ts" "$AGENT_DIR/hooks/pre/lean-ctx-native-reroute.ts" "${RLOB}agent/hooks/pre/lean-ctx-native-reroute.ts"
sync_file "$PLUGIN_SRC/hooks/pre/harness-evasion-guard.ts" "$AGENT_DIR/hooks/pre/harness-evasion-guard.ts" "${RLOB}agent/hooks/pre/harness-evasion-guard.ts"

# ---- 1b) universal project rules (installed to both agent/ and root level) ----
if [[ -d "$PLUGIN_SRC/rules" ]]; then
  echo "==> universal project rules"
  for rule in "$PLUGIN_SRC"/rules/*.md; do
    [[ -e "$rule" ]] || continue
    sync_file "$rule" "$RULES_DIR/$(basename "$rule")" "${RLOB}agent/rules/$(basename "$rule")"
    sync_file "$rule" "$ROOT_RULES_DIR/$(basename "$rule")" "${RLOB}rules/$(basename "$rule")"
  done
fi

# ---- 1c) per-profile payloads (from repo profiles/<name>/agent/) ----
if [[ -d "$REPO_ROOT/profiles" ]]; then
  echo "==> per-profile payloads"
  for profile_dir in "$REPO_ROOT/profiles"/*/agent/; do
    [[ -e "$profile_dir" ]] || continue
    profile_name="$(basename "$(dirname "$profile_dir")")"
    profile_agent_dir="$OMP_ROOT/profiles/$profile_name/agent"
    echo "    profile: $profile_name"
    for src_file in "$profile_dir"/*; do
      [[ -e "$src_file" ]] || continue
      [[ -f "$src_file" ]] || continue
      src_basename="$(basename "$src_file")"
      # only install config.yml and AGENTS.md at profile level
      [[ "$src_basename" == "config.yml" || "$src_basename" == "AGENTS.md" ]] || continue
      sync_file "$src_file" "$profile_agent_dir/$src_basename" \
        "${RLOB}profiles/$profile_name/agent/$src_basename"
    done
  done
fi

# ---- 2) plugin-package registration (marketplace / `omp plugin` discovery) ----
if [[ "$NO_PLUGIN" -eq 0 ]]; then
  echo "==> plugin package registration"
  sync_dir "$PLUGIN_SRC" "$PLUGIN_DIR/node_modules/$PKG_NAME" "${RLOB}plugins/node_modules/$PKG_NAME"

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

# ---- 3) reconciliation + summary ----
reconcile
manifest_save

echo
echo "==> summary: $INSTALLED installed, $UPDATED updated, $UNCHANGED up to date, $KEPT kept, $REMOVED removed"
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
