---
name: research-before-complex-build
description: "For complex functionality, run parallel research before building: existing reliable implementations, mature libraries, and dependencies already usable — use the harness's parallel research tools (librarian, library-docs MCP, web search, subagents) and prefer proven building blocks over inventing complex behavior from scratch"
condition: ["^(?=[\\s\\S]*complex (functionality|feature|logic|module|system))(?=[\\s\\S]*implement(ing)? (a )?(complex|non-trivial|advanced))(?=[\\s\\S]*research[\\s\\S]{0,40}?(implement|library|dependenc|existing))(?=[\\s\\S]*existing (reliable )?(implement|solution|library)|proven (library|implementation))(?=[\\s\\S]*which (library|dependency|implementation)|pick (a )?(library|dependency))(?=[\\s\\S]*build from scratch|reinvent)"]
scope: ["text", "thinking"]
---

For complex functionality, run parallel research BEFORE building: it is almost never novel — a proven implementation, library, or usable dependency usually exists; inventing is slower, buggier, unmaintained-by-you. (discover-before-create covers in-repo reuse.)

RESEARCH IN PARALLEL — concurrent subagents/tools in one batch:
- LIBRARIES: librarian + library-docs MCP (context7, deepwiki).
- EXISTING IMPLEMENTATIONS: open-source precedents via deepwiki/repo research — learn the proven shape, don't guess.
- DEPENDENCIES: what the repo already ships beats a new dep.

PREFER PROVEN: maintained, ecosystem-standard > experimental > self-written (see repo-tooling-scoped-usage). Small well-understood beats large barely-controlled, but a dep solving the hard 90% beats one extended into the hard 10%. Decide by maintenance, maturity, size, license, ecosystem fit, already-in-repo; record the comparison.

DON'T OVER-APPLY:
- Research targets complex behavior; simple functionality uses the stdlib — no gold-plating.
- Prefer no new dep when stdlib/an existing dep suffices; flag when a new dep is the only path.
- No reliable implementation exists → say so before building; a legitimate outcome.
