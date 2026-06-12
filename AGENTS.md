# Agent instructions

**First: check `docs/STATUS.md` to see which build step is next and what
already exists.** The build has a strict step order (SPEC.md §"Build order");
do not start a step until the previous one is CI-green and STATUS.md is updated.

Before touching anything in `/packages/engine` (or any code that depends on
`GameState` shape), read `docs/invariants.md` in full. It contains the
load-bearing formulas for legality, turn order, betting-round completion,
pot settlement, and payouts — several "obviously correct" simplifications of
these are wrong in specific, non-obvious ways that have already been found
once (the doc records the counter-examples). Do not "simplify" a formula in
`invariants.md` without first checking it against the rejected-alternatives
list in the relevant section.

`docs/SPEC.md` has the module map, dependency direction (`engine` ->
`math` -> `training`, one-way), repo layout, and build order.

## Workflow for each module

1. Read the relevant section(s) of `invariants.md`.
2. Write the test file first, encoding every example/counter-example from
   that section as a literal test case, plus the standard cases (heads-up
   BB option, short all-in non-reopen, multi-way side pot with a mid-street
   fold, odd-chip remainder with split pots, wheel straight / straight
   flush vs flush evaluator cases, etc.).
3. Implement against the tests. `apply` must contain ~0 poker logic
   (arithmetic only) — if you find yourself adding a conditional to `apply`
   that isn't "this event type updates these fields," that logic probably
   belongs in `attempt` or a derived query instead.
4. CI green before moving to the next module. Do not start the next
   module's implementation in the same PR.

## Things that look like missing features but are intentional scope cuts

See "Explicitly out of scope" in `SPEC.md` — SolverPolicy, ExploitPolicy,
hand continuation after a Verdict, lookup-table evaluator, licensed range
data. Do not add stubs or partial implementations for these without
revisiting `SPEC.md` first.
