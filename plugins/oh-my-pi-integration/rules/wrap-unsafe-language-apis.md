---
name: wrap-unsafe-language-apis
description: "Common unsafe standard-library functionality must be wrapped and properly error-handled, not called raw: eval/exec, pickle/yaml.load, shell=True subprocess, unwrap/expect, unchecked indexing, default HTTP clients, unbounded reads — if the repo provides a safe wrapper use it, otherwise wrap at the boundary with validation, error handling, and safe defaults"
condition: ["\\beval\\(|\\bexec\\(|new Function", "pickle|yaml\\.load|load_model|torch\\.load", "shell\\s*=\\s*True|os\\.system|child_process\\.(exec|execSync)|spawn", "unwrap\\(\\)|expect\\(|\\[i\\].*panic|unsafe", "http\\.(Get|Client)|default.*client|no timeout", "io\\.ReadAll|readAll|read_to_end", "unsafe (function|api|call|standard)", "error handling|error-handl", "wrap.*(unsafe|standard)"]
scope: ["text", "thinking"]
---

Common unsafe standard-library functionality must be wrapped and properly error-handled, never called raw. Every language ships functions that are convenient and dangerous; the pattern is the same everywhere: identify the unsafe surface, wrap it at the boundary with validation + error handling + safe defaults.

PER-LANGUAGE PITFALLS (known classes; each has a wrapped or safe alternative):
- PYTHON: `eval`/`exec`/`compile` (code injection); `pickle`/`cPickle` and ML loaders (`torch.load`, Keras `Model.load_model`) — arbitrary code execution, CVE-2025-9905 showed `load_model` RCE even with `safe_mode=True`; `yaml.load` (use `yaml.safe_load`); `subprocess`/`os.system` with `shell=True` (shell injection — pass arg lists / `shlex` instead); `assert` for validation (stripped under `-O`, not a safety check).
- JS/TS: `eval`/`new Function` (code injection); `child_process.exec`/`execSync` (shell injection — use `spawn` with arg arrays); `innerHTML` (XSS); raw `JSON.parse` (see prefer-repo-json-buffer-wrappers).
- GO: the default `http.Client{}` / `http.Get` — NO timeouts by default (a hanging dependency leaks goroutines forever); ignored errors (`_, _ =`); nil-map writes (panic); unbounded `io.ReadAll`; string concat in loops.
- RUST: `unwrap()`/`expect()` on error paths (panic in production — propagate with `?` and context instead); unchecked indexing `v[i]` (panic — use `.get()`); `unsafe` blocks; `String::from_utf8_lossy` (silent replacement — validate with `from_utf8`); debug-only vs release integer overflow.
- C/C++: `gets`/`strcpy`/`sprintf` (buffer overflow — use bounded variants); format strings with user input (format-string vulnerability); unchecked allocation/arithmetic.
- COMMON: unbounded reads of any stream; regexes with catastrophic backtracking (see named-tested-regexes); time parsing without explicit layout/zone; path joins that trust input.

THE PATTERN:
1. DETECT the unsafe call in code you touch.
2. USE THE REPO'S SAFE WRAPPER if one exists (see prefer-repo-json-buffer-wrappers).
3. ELSE WRAP AT THE BOUNDARY: validation before the call, explicit error handling on every failure path, safe defaults (timeouts, size limits, encoding, no-shell), and a name that says what it guarantees.
4. NEVER BROADEN THE UNSAFE SURFACE: a raw call stays raw only when it is the repo's established pattern and the input is trusted — and even then, flag it.
5. TESTS KEEP RAW CALLS: in test code, raw usage is fine — failure there is the early flag (same carve-out as prefer-repo-json-buffer-wrappers).

DON'T OVER-APPLY: wrap what you touch; do not invent a wrapper layer wholesale for code you never modify. For legacy raw usage, state the gap and propose the wrapper rather than silently rewriting (see repo-tooling-scoped-usage).
