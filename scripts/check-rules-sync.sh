#!/usr/bin/env bash
# check-rules-sync.sh — validate the universal rules bundle (schema + laydown).
#
#   1. Schema: every plugins/oh-my-pi-integration/rules/*.md carries the
#      frontmatter contract — `name` equals the filename stem, non-empty
#      `description`, non-empty `condition`, and a `scope` limited to
#      text | thinking | tool:<name>[(pattern)].
#   2. Sync: the installer's dry-run lays exactly as many rules as ship —
#      catches renamed/removed rules that a stale target would keep, and
#      laydown regressions (a rule that stopped being laid down).
#
# Usage:
#   ./scripts/check-rules-sync.sh [--schema-only]   # skip the installer dry-run

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULES_DIR="$REPO_ROOT/plugins/oh-my-pi-integration/rules"
SCHEMA_ONLY=0
[[ "${1:-}" == "--schema-only" ]] && SCHEMA_ONLY=1

echo "==> rules schema check ($RULES_DIR)"
if ! schema_out="$(python3 - "$RULES_DIR" <<'PY'
import os, re, sys
rules_dir = sys.argv[1]
VALID = ("text", "thinking")
tool_re = re.compile(r"^tool:[a-z][a-z0-9-]*(\([^)]*\))?$")
fail = 0
n = 0
for fn in sorted(os.listdir(rules_dir)):
    if not fn.endswith(".md"):
        continue
    n += 1
    stem = fn[:-3]
    path = os.path.join(rules_dir, fn)
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        print(f"FAIL {fn}: missing frontmatter")
        fail += 1
        continue
    fields = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k = k.strip()
        if k and k not in fields:
            fields[k] = v.strip().strip('"')
    if fields.get("name") != stem:
        print(f"FAIL {fn}: frontmatter name {fields.get('name')!r} != filename stem {stem!r}")
        fail += 1
    if not fields.get("description"):
        print(f"FAIL {fn}: missing description")
        fail += 1
    if not fields.get("condition"):
        print(f"FAIL {fn}: missing condition")
        fail += 1
    scope_raw = fields.get("scope", "")
    items = [x.strip().strip('"') for x in scope_raw.strip("[]").split(",") if x.strip()]
    if not items:
        print(f"FAIL {fn}: missing/empty scope")
        fail += 1
    for it in items:
        if it not in VALID and not tool_re.match(it):
            print(f"FAIL {fn}: invalid scope entry {it!r}")
            fail += 1
print(f"checked {n} rules, {fail} failures")
sys.exit(1 if fail else 0)
PY
)"; then
  echo "$schema_out"
  echo "ERROR: rules schema broken" >&2
  exit 1
fi
echo "$schema_out"

count="${schema_out#checked }"
count="${count%% rules*}"

if [[ "$SCHEMA_ONLY" -eq 0 ]]; then
  echo "==> rules laydown sync (installer dry-run)"
  # dual install: each rule goes to both agent/rules/ and rules/
  laid="$(
    bash "$REPO_ROOT/scripts/install.sh" --dry-run --target "/tmp/rules-check-$$" 2>&1 \
      | grep -cE '\.omp/(agent/)?rules/' || true
  )"
  expected="$(( count * 2 ))"
  echo "    shipped: $count   laid: $laid (expected: $expected)"
  if [[ "$laid" != "$expected" ]]; then
    echo "ERROR: laid ($laid) != expected ($expected) — rules may not be dual-installed correctly" >&2
    exit 1
  fi
fi

echo "==> rules bundle OK"
