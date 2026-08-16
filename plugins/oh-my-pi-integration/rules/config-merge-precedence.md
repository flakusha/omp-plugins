---
name: config-merge-precedence
description: "For configs, config files, config data structures — identify domain, mergeability, creation of examples, logics of merges and prevalence of config: command-line arguments -> env -> config files -> defaults"
condition: ["^(?=[\\s\\S]*config|configuration|settings)(?=[\\s\\S]*CLI|command[- ]line|flag|argument|option)(?=[\\s\\S]*environment variable|env var|\\bENV\\b|process\\.env)(?=[\\s\\S]*default|precedence|override|merge|deep merge|fallback)(?=[\\s\\S]*example config|config example|sample)"]
scope: ["text", "thinking"]
---

When creating configs, config files, or config data structures, identify FIVE aspects explicitly — domain, mergeability, examples, merge logic, and prevalence order.

1) DOMAIN: what does this config govern, and what is its scope boundary? A config that silently covers more than its name implies is a trap (see state-fields-over-boolean-flags: name what it is).
2) MERGEABILITY: can multiple config sources combine? Which parts of the config are per-source (each source contributes keys) vs single-source (later source wins wholesale)?
3) EXAMPLES: create example configs that document REAL usage — a working minimal example plus the interesting variations — not an exhaustive dump of every field. Examples are the executable documentation of the domain.
4) LOGICS OF MERGES: state how sources combine PER KEY — scalar override (later wins), deep merge (objects recurse), array REPLACE vs CONCAT (which one? name it). Mixed semantics are the #1 config bug; the merge logic must be explicit, deterministic, and documented.
5) PREVALENCE OF CONFIG — the canonical precedence ladder:
   command-line arguments > environment variables > config files > defaults
   Each rung overrides the next; document per-key when a key is only honored at specific rungs (e.g. "CLI-only", "env-only") instead of pretending the ladder is uniform.

TIES: config-established-interfaces (types at the boundary), api-schema-versioning (schema for the config contract), strict-types-and-reuse, forward-compatible-datastructures (extras for forward-compat config keys).

DON'T OVER-APPLY: a single-source config still needs domain + defaults + an example; it only skips the merge-logic and ladder analysis when there is literally one source. And do not invent multi-rung precedence for configs that are consumed in exactly one way — document what exists, don't build scaffolding for hypothetical sources.
