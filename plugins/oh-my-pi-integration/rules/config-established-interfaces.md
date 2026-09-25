---
name: config-established-interfaces
description: "When creating configs, config data structures and so on — consider using established interfaces in case some external libraries are used, instead of creating local config subset(s)"
condition: ["^(?=[\\s\\S]*config|configuration|settings|options object|config file)(?=[\\s\\S]*interface|schema|type|typedef)(?=[\\s\\S]*external (library|dependency|package)|library (config|options)|third-party)(?=[\\s\\S]*subset|map (to|from)|translate|bridge|own (config|options))"]
scope: ["text", "thinking"]
---

For code consuming external libraries, prefer the library's OWN config types (or Pick/Omit selections) over hand-made local subsets.

WHY: (1) compiler checks the config against what the library accepts; (2) no drift — library changes update the type with it; (3) no lossy subset — hand-mapped subsets drop fields and force re-mapping (see wrap-unsafe-language-apis, api-schema-versioning).

- Interface too broad? SELECT (Pick/extends/intersection) — still tracks the source of truth.
- TIES: forward-compatible-datastructures (extras catch-all, not local redefinition), strict-types-and-reuse (reuse, don't re-type), discover-before-create.
- DON'T OVER-APPLY: configs for YOUR OWN code with no external consumer are yours to design. The rule targets configs mirroring external libraries — there a parallel subset is duplicated truth with all the drift that implies.
