---
name: config-merge-precedence
description: "For configs, config files, config data structures — identify domain, mergeability, creation of examples, logics of merges and prevalence of config: command-line arguments -> env -> config files -> defaults"
condition: ["^(?=[\\s\\S]*config|configuration|settings)(?=[\\s\\S]*CLI|command[- ]line|flag|argument|option)(?=[\\s\\S]*environment variable|env var|\\bENV\\b|process\\.env)(?=[\\s\\S]*default|precedence|override|merge|deep merge|fallback)(?=[\\s\\S]*example config|config example|sample)"]
scope: ["text", "thinking"]
---

For configs, identify FIVE aspects explicitly:

1) DOMAIN: what it governs + scope boundary — silent over-coverage is a trap (see state-fields-over-boolean-flags).
2) MERGEABILITY: sources combine? per-source keys vs single-source wholesale.
3) EXAMPLES: minimal working example + interesting variations, not an exhaustive dump — executable documentation.
4) MERGE LOGIC: per key — scalar override (later wins), deep merge, array REPLACE vs CONCAT (name it). Mixed semantics are the #1 config bug; explicit, deterministic, documented.
5) PREVALENCE: CLI arguments > env vars > config files > defaults; per-key rung restrictions ("CLI-only") documented.

- TIES: config-established-interfaces, api-schema-versioning, strict-types-and-reuse, forward-compatible-datastructures.
- DON'T OVER-APPLY: single-source config still needs domain + defaults + example, but skips merge/ladder analysis; no invented precedence for configs consumed one way.
