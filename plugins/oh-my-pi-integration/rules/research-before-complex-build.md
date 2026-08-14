---
name: research-before-complex-build
description: "For complex functionality, run parallel research before building: existing reliable implementations, mature libraries, and dependencies already usable — use the harness's parallel research tools (librarian, library-docs MCP, web search, subagents) and prefer proven building blocks over inventing complex behavior from scratch"
condition: ["(?=[\\s\\S]*complex (functionality|feature|logic|module|system))(?=[\\s\\S]*implement(ing)? (a )?(complex|non-trivial|advanced))(?=[\\s\\S]*research.*(implement|library|dependenc|existing))(?=[\\s\\S]*existing (reliable )?(implement|solution|library)|proven (library|implementation))(?=[\\s\\S]*which (library|dependency|implementation)|pick (a )?(library|dependency))(?=[\\s\\S]*build from scratch|reinvent)"]
scope: ["text", "thinking"]
---

For complex functionality, run parallel research BEFORE building. Complex behavior is almost never novel — a proven implementation, mature library, or usable dependency almost always exists. Inventing it from scratch is slower, buggier, and unmaintained-by-you from day one. discover-before-create covers in-repo reuse; this rule covers out-of-repo research.

RESEARCH IN PARALLEL (this is exactly what the harness's parallel research tools are for):
- LIBRARY RESEARCH: librarian agents and library-docs MCP (context7, bun docs, deepwiki) for mature, maintained, widely-used libraries that already implement the behavior.
- EXISTING IMPLEMENTATIONS: open-source precedents (source-level: how did a reliable project solve this?) via deepwiki / repo research — learn from the proven shape, don't guess the shape.
- DEPENDENCIES: check what is already in the repo's dependency tree or vendorable — a dependency you already ship is cheaper and safer than a new one.
- RUN THEM CONCURRENTLY: independent research questions go to parallel subagents/tools in one batch, not one-at-a-time (see the harness's delegation rules).

PREFER PROVEN BUILDING BLOCKS:
- Mature, maintained, standard/community-blessed > experimental > self-written. Prefer the library the ecosystem standardizes on (the repo's own ecosystem and conventions — see repo-tooling-scoped-usage).
- A small, well-understood library beats a large one you barely control; but a large one that solves the hard 90% beats a small one you must extend into the hard 10%.
- DECISION CRITERIA: maintenance (activity, issues), maturity (stability, API stability), size/weight, license, ecosystem fit, and whether it already exists in the repo. Record the comparison; pick deliberately, not by familiarity.

DON'T OVER-APPLY:
- Research is for complex, non-trivial behavior. For simple functionality, reach for the stdlib or the obvious approach — do not gold-plate with a dependency hunt.
- Adding a dependency is a real decision: prefer no new dependency when the stdlib or an existing dep suffices; prefer the safest existing option otherwise. Flag when a new dependency is the only path.
- If no reliable implementation exists, state that finding explicitly (it is a legitimate research outcome) before building, rather than silently writing from scratch.
