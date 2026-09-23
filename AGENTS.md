# Global Agent Instructions (oh-my-pi / omp)

The oh-my-pi-integration plugin carries `<project>/.omp/receipt.toml` into every turn as an invisible footer message — a cross-turn job ledger, so work state survives without re-derivation.

- Keep entries terse; the first key of each `[[job]]`/`[[issue]]` is its id.
- `state` is `finished` (set the moment a job completes), `in progress` (default), or `postponed`; mark blockers with a `# Blocker` comment inside the entry.
- Add new `[[job]]`/`[[issue]]` entries as work emerges.
- Plugin chores each carry: bumps `n`, stamps finished jobs with `done_at`, drops finished jobs after 3 receipts, prunes empty entries. Fail-open — a malformed ledger means no footer and no write. Opt out per session with `PI_RECEIPT_DISABLE=1`.
