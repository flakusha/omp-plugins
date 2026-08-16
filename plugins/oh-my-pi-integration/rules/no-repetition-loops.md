---
name: no-repetition-loops
description: "Hallucination protection for thinking/monologue: 3+ near-identical phrases, justifications, or tool-call intents in a reasoning window means reasoning is pattern-matching its own output instead of grounding in evidence — stop, re-ground, state each claim once with evidence, or downgrade it"
condition: ["^(?=[\\s\\S]*as I (said|mentioned|established))(?=[\\s\\S]*as established (above|earlier|before))(?=[\\s\\S]*we (showed|saw|established) above)(?=[\\s\\S]*per my (earlier|previous) analysis)(?=[\\s\\S]*consistent with (my|our) earlier)(?=[\\s\\S]*this confirms (my|our) previous)(?=[\\s\\S]*to (reiterate|repeat|be clear))(?=[\\s\\S]*again,)(?=[\\s\\S]*let me (re-)?(verify|double-check|confirm|restate|recompute))(?=[\\s\\S]*I already (said|established|showed|verified))(?=[\\s\\S]*(same|identical|reworded) (claim|phrase|reasoning|pattern|justification|point|conclusion|idea))(?=[\\s\\S]*note that[\\s\\S]{0,40}?(again|repeatedly))"]
scope: ["thinking", "text"]
---

Repetition is a hallucination warning, not a style tic. When the same or near-identical phrase, justification, or tool-call intent appears 3+ times within a reasoning window — or you find yourself echoing your own prior claims verbatim — your reasoning is pattern-matching on your own output, not grounding in evidence. Long thinking/monologue phases make this worse: models drift into repeating n-grams as their context fills with self-generated text, and fluent repetition is how confabulation fills gaps in thin evidence.

Steer out of it:

1. STOP repeating. Do not restate, re-justify, or "double-check" the same claim in the same words — that adds no information and entrenches the loop.
2. RE-GROUND: re-read the actual source code, tool output, or document the claim rests on. Evidence first, memory never.
3. STATE ONCE, FRESHLY: each claim appears exactly once, phrased from the evidence, with its citation (file:line, tool result, command output). No padding restatements.
4. DOWNGRADE OR DROP: if re-grounding yields no new evidence, the claim is a guess — mark it as such or drop it. Never substitute restatement for evidence.
5. TOOL LOOPS ARE THE SAME DISEASE: identical tool-call intent (`i`) fields or identical commands re-run with no state change mean the loop is self-feeding. Re-check the state that would change, then act — or escalate.

Common pattern signatures (research-backed — arXiv 2601.05693, 2310.10226):
- SEMANTIC ECHO: the same claim reworded. Semantic repetition precedes textual repetition — catch it at the paraphrase stage, before verbatim loops form.
- CIRCULAR SELF-CITATION: your own earlier output used as a premise ("as established above", "this confirms my previous finding"). Generated content acting as evidence for its own recurrence is the core loop mechanism.
- NUMERICAL LOOPS: re-computing or re-reporting the same numbers (counts, metrics, timings) with no new input.
- STATEMENT LOOPS: verbatim or near-verbatim claim repetition.
- IMPASSE-TRIGGERED ONSET: loops start when reasoning stalls. The moment you cannot advance, that is the danger zone — escalate immediately instead of re-attempting.
- TOOL DEGENERATION: repeated identical tool calls until the token limit — wasted compute and cost (SpecRA: agents hit this like chatbots do).

ESCALATE when stuck: if the same conclusion with the same reasoning has been attempted 3+ times, do not try a 4th phrasing — report the loop, propose a new decomposition or a different source of evidence, or ask the user. Loops are solved by new input, not more output.
