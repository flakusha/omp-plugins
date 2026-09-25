---
name: no-repetition-loops
description: "Hallucination protection for thinking/monologue: 3+ near-identical phrases, justifications, or tool-call intents in a reasoning window means reasoning is pattern-matching its own output instead of grounding in evidence — stop, re-ground, state each claim once with evidence, or downgrade it"
condition: ["^(?=[\\s\\S]*as I (said|mentioned|established))(?=[\\s\\S]*as established (above|earlier|before))(?=[\\s\\S]*we (showed|saw|established) above)(?=[\\s\\S]*per my (earlier|previous) analysis)(?=[\\s\\S]*consistent with (my|our) earlier)(?=[\\s\\S]*this confirms (my|our) previous)(?=[\\s\\S]*to (reiterate|repeat|be clear))(?=[\\s\\S]*again,)(?=[\\s\\S]*let me (re-)?(verify|double-check|confirm|restate|recompute))(?=[\\s\\S]*I already (said|established|showed|verified))(?=[\\s\\S]*(same|identical|reworded) (claim|phrase|reasoning|pattern|justification|point|conclusion|idea))(?=[\\s\\S]*note that[\\s\\S]{0,40}?(again|repeatedly))"]
scope: ["thinking", "text"]
---

Repetition is a hallucination warning: a same/near-identical phrase, justification, or tool-call intent 3+ times in a reasoning window = reasoning pattern-matching its own output, not grounding in evidence (long thinking worsens it; fluent repetition is how confabulation fills thin evidence).
STEER OUT:
1. STOP — no restating/re-justifying/double-checking the same claim in the same words.
2. RE-GROUND — re-read the actual source/tool output/document; evidence, never memory.
3. STATE ONCE — each claim once, from evidence, cited (file:line, tool result, output).
4. DOWNGRADE OR DROP — no new evidence after re-grounding = guess; mark or drop.
5. TOOL LOOPS — identical `i` fields/commands re-run with no state change: re-check what would change, act, or escalate.
SIGNATURES (arXiv 2601.05693, 2310.10226): semantic echo (reworded claim — catch before verbatim loops); circular self-citation (own output as premise); numerical loops (same numbers, no new input); statement loops (verbatim); impasse onset (loops start at stalls — escalate); tool degeneration (identical calls until token limit).
ESCALATE: same conclusion + reasoning 3+ times → no 4th phrasing; report the loop; propose a new decomposition/evidence source or ask the user. Loops die by new input, not more output.
