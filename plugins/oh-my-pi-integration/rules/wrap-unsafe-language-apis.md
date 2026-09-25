---
name: wrap-unsafe-language-apis
description: "Common unsafe standard-library functionality must be wrapped and properly error-handled, not called raw: eval/exec, pickle/yaml.load, shell=True subprocess, unwrap/expect, unchecked indexing, default HTTP clients, unbounded reads — if the repo provides a safe wrapper use it, otherwise wrap at the boundary with validation, error handling, and safe defaults"
condition: ["^(?=[\\s\\S]*\\beval\\(|\\bexec\\(|new Function)(?=[\\s\\S]*pickle|yaml\\.load|load_model|torch\\.load)(?=[\\s\\S]*shell\\s*=\\s*True|os\\.system|child_process\\.(exec|execSync)|spawn)(?=[\\s\\S]*unwrap\\(\\)|expect\\(|\\[i\\][\\s\\S]{0,40}?panic|unsafe)(?=[\\s\\S]*http\\.(Get|Client)|default[\\s\\S]{0,40}?client|no timeout)(?=[\\s\\S]*io\\.ReadAll|readAll|read_to_end)(?=[\\s\\S]*unsafe (function|api|call|standard))(?=[\\s\\S]*error handling|error-handl)(?=[\\s\\S]*wrap[\\s\\S]{0,40}?(unsafe|standard))"]
scope: ["text", "thinking"]
---

Unsafe stdlib calls are wrapped + error-handled, never raw: identify the unsafe surface; wrap at the boundary with validation, error handling, safe defaults.

PITFALLS:
- PYTHON: eval/exec/compile; pickle/torch.load/load_model execute code (CVE-2025-9905 RCE despite safe_mode=True); yaml.load → safe_load; shell=True → arg lists/shlex; assert stripped under -O.
- JS/TS: eval/new Function; child_process.exec(Sync) → spawn + arg arrays; innerHTML (XSS); raw JSON.parse (see prefer-repo-json-buffer-wrappers).
- GO: default http.Client/http.Get lack timeouts; ignored errors (`_, _ =`); nil-map writes; unbounded io.ReadAll.
- RUST: unwrap()/expect() → ? + context; unchecked v[i] → .get(); unsafe blocks; from_utf8_lossy silently replaces → from_utf8.
- C/C++: gets/strcpy/sprintf → bounded variants; user input in format strings; unchecked alloc/arith.
- COMMON: unbounded reads; catastrophic regexes (see named-tested-regexes); time parsing without explicit layout/zone; trusting path joins.

PATTERN: 1) DETECT unsafe calls in touched code. 2) USE the repo's safe wrapper if one exists (see prefer-repo-json-buffer-wrappers). 3) ELSE wrap at the boundary: validation before, error handling on failure paths, safe defaults (timeouts, size limits, encoding, no-shell), name states the guarantee. 4) NEVER broaden the unsafe surface: raw stays raw only as repo-established pattern + trusted input — flagged even then. 5) TESTS KEEP RAW CALLS — failure there is the early flag.

DON'T OVER-APPLY: wrap what you touch; no wholesale wrappers elsewhere; legacy raw: state the gap, propose the wrapper, no silent rewrite (see repo-tooling-scoped-usage).
