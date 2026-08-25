#!/usr/bin/env bash
# check-regex-safety.sh — ReDoS / perf lint for TTSR rule `condition` regexes.
#
# Detects two independent hazards in plugins/oh-my-pi-integration/rules/*.md:
#
#   1. ERROR — unbounded `.*` (dot-star): after a `[\s\S]*` lead, a bare `.*`
#      between two anchors backtracks quadratically (measured 100–500ms per
#      `.test()` on ~4 KB). Fix: bound it (`[\s\S]{0,40}?`) or split the facet
#      into two lookaheads (`(?=[\s\S]*X)(?=[\s\S]*Y)`) per the README AND-facet
#      idiom.
#
#   2. ERROR — unanchored lookahead chain. A condition that starts with `(?=`
#      but not `^(?=` is a zero-width regex with no anchor: on non-matching
#      input, .test() retries the full greedy `[\s\S]*` scan at every stream
#      position -> O(n^2) (measured ~2.3 s across 75 rules on 8 KB non-match;
#      1.2 ms anchored). Fix: prepend `^` to the chain. Semantically identical
#      (each facet's `[\s\S]*` already scans the whole stream from position 0).
#
#   3. WARN — greedy `[\s\S]*` lead in a lookahead. In Bun/JavaScriptCore the
#      greedy `[\s\S]*` prefix defeats the engine's literal fast-path search:
#      `(?=[\s\S]*documentation)` is ~35,000× slower than bare `documentation`
#      (~3.8 ms vs 0.11 µs on 2.8 KB). This is a constant-factor per-delta cost
#      (structural: every facet has one). Mitigation is engine-level: test
#      each facet as a bare regex and AND the results, or for rules with ≤3
#      facets rewrite the AND-chain as an OR-of-permutations
#      (`A[\s\S]*B|B[\s\S]*A` ≈ 1000× faster). Not fixable in the rule text
#      alone, hence a warning, not an error.
#
# Usage: ./scripts/check-regex-safety.sh   (exit 1 only on nested-wildcard errors)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULES_DIR="$REPO_ROOT/plugins/oh-my-pi-integration/rules"

python3 - "$RULES_DIR" <<'PY'
import json, re, sys, os

rules_dir = sys.argv[1]

# Unbounded dot-star (`.*`) — the quadratic ReDoS shape. After a `[\s\S]*`
# lead, a bare `.*` between two anchors backtracks quadratically. Bounded
# quantifiers (`{0,N}`) are fine; a bare `.*` is the signal to catch.
DOTSTAR_RE = re.compile(r"\.\*")
# Greedy `[\s\S]*` lead (informational JSC hazard, not fixable in rule text).
GREEDY_LEAD_RE = re.compile(r"\(\?=\[\\s\\S\]\*")

errors = 0
warnings = 0
for fn in sorted(os.listdir(rules_dir)):
    if not fn.endswith(".md"):
        continue
    text = open(os.path.join(rules_dir, fn), encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        continue
    cond = None
    for line in m.group(1).splitlines():
        if line.startswith("condition:"):
            cond = line.split(":", 1)[1].strip()
            break
    if not cond:
        continue
    # Unescape the JSON/YAML condition to its single-backslash regex form.
    # Fail loud on JSON parse error — silently `continue`ing (the previous
    # behavior) shipped a broken regex into the live profile without
    # any signal at the check layer (no-git-stash-blocked regression).
    try:
        conds = json.loads(cond)
    except Exception as e:
        print(f"ERROR {fn}: cannot parse condition as JSON: {e}")
        errors += 1
        continue
    if isinstance(conds, str):
        conds = [conds]
    for c in conds:
        if DOTSTAR_RE.search(c):
            print(f"ERROR {fn}: unbounded .* (quadratic backtracking): {c[:80]}...")
            errors += 1
        if c.startswith("(?=") and not c.startswith("^(?="):
            print(f"ERROR {fn}: unanchored lookahead chain (O(n^2) ReDoS): {c[:80]}...")
            errors += 1
        if GREEDY_LEAD_RE.search(c):
            warnings += 1  # counted, not printed per-file (every rule triggers it)

print(f"checked {len(os.listdir(rules_dir))} rule files: {errors} regex-safety errors, {warnings} greedy-lead warnings")
sys.exit(1 if errors else 0)
PY
