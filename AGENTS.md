# Global Agent Instructions (oh-my-pi / omp)

Agent-scoped rules for this oh-my-pi (omp) agent.

<!-- receipt -->
## Receipt carriage (`.omp/receipt.toml`)

The oh-my-pi-integration plugin carries a small job ledger from
`<project>/.omp/receipt.toml` into every turn as an invisible footer
message, so cross-turn work state survives without re-derivation.

Document shape (no strict spec; comments and unknown keys are preserved):

```toml
[carriage]
n = 4                      # plugin-managed carry counter

[[job]]
F-01 = "make the cicd happy"
state = "finished"         # finished | in progress | postponed (default: in progress)

[[job]]
F-02 = "improve database performance"
state = "in progress"

[[issue]]
tooling = "failed to access `.tmp/report.json`"
```

Agent duties:
- Keep entries terse; the first key of each `[[job]]`/`[[issue]]` is its id.
- Set `state = "finished"` the moment a job completes.
- Add new `[[job]]`/`[[issue]]` entries as work emerges; mark blockers with
  a `# Blocker` comment inside the entry.

Chores (plugin, each carry): bumps `n`, stamps finished jobs with
`done_at`, drops finished jobs after 3 receipts, and prunes empty entries.
Everything is fail-open: a malformed or unreadable ledger means no footer
and no write. Opt out per session with `PI_RECEIPT_DISABLE=1`.
