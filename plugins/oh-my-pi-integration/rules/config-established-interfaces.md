---
name: config-established-interfaces
description: "When creating configs, config data structures and so on — consider using established interfaces in case some external libraries are used, instead of creating local config subset(s)"
condition: ["^(?=[\\s\\S]*config|configuration|settings|options object|config file)(?=[\\s\\S]*interface|schema|type|typedef)(?=[\\s\\S]*external (library|dependency|package)|library (config|options)|third-party)(?=[\\s\\S]*subset|map (to|from)|translate|bridge|own (config|options))"]
scope: ["text", "thinking"]
---

When creating configs and config data structures for code that consumes external libraries, prefer the ESTABLISHED INTERFACES of those libraries over hand-made local config subsets.

THE RULE:
- If a library is in play, consume its own config types/interfaces where possible: type the config as the library's option type (or a Pick/Omit selection of it) instead of inventing a parallel local shape that must be mapped by hand.
- WHY: (1) TYPE SAFETY AT THE BOUNDARY — the compiler checks your config against what the library actually accepts; (2) NO DRIFT — when the library adds/changes options, the config type updates with it instead of silently diverging; (3) NO LOSSY SUBSET — a hand-mapped subset drops fields and forces re-mapping every time the library evolves (see wrap-unsafe-language-apis: the boundary is where correctness lives; see api-schema-versioning: version contracts at compatibility boundaries).
- If the library's interface is too broad for your config surface, SELECT from it (Pick/extends/intersection) rather than redefining — the selection still tracks the source of truth.

TIES: forward-compatible-datastructures (external-boundary structures: extras catch-all, not local redefinition), strict-types-and-reuse (reuse the existing type — do not re-type), discover-before-create (check whether the interface already exists before inventing one).

DON'T OVER-APPLY: configs for YOUR OWN code with no external consumer are yours to design. The rule targets configs that mirror or bridge external libraries — there, the library's interface is the established interface, and a parallel local subset is duplicated truth with all the drift that implies.
