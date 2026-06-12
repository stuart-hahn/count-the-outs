# Build Status

Track progress against the 10-step build order in `SPEC.md`. Update this file
when a step's PR merges. Each step = its own PR, CI green before next starts.

## Steps

| # | What | Status | Notes |
|---|------|--------|-------|
| 1 | `engine/cards.ts` + `math/handEvaluator.ts` | ✅ done | 54 tests; naive C(7,5) eval; wheel straight, all category/kicker/tie cases covered |
| 2 | `engine/gameState.ts` + `transitions.ts` + `kernel.ts` | 🔜 next | heads-up only, single pot; formula-driven test table first (BB option, short all-in non-reopen, reopened predicate) |
| 3 | `engine/pots.ts` | — | `settlePots`/`payouts`; tested standalone with hand-constructed commitment tables |
| 4 | `engine/table.ts` | — | hand lifecycle, heads-up button toggle → **checkpoint: playable heads-up NLHE loop** |
| 5 | `math/range.ts` + `math/equity.ts` | — | Range parsing, card removal, exact/MC equity |
| 6 | `training/scenarioBuilder.ts` + `policies.ts` | — | EVPolicy + EquityPolicy first → **checkpoint: pot-odds/equity drills** |
| 7 | `training/ranges/` + `RangePolicy` | — | ~10-20 heuristic reference ranges → **checkpoint: preflop open/3bet drills** |
| 8 | N-player generalization (3–6 seats) | — | `seatOrder`/`buttonSeat`/`nextButton`; kernel already general |
| 9 | Multi-pot stress test | — | extensive regression suite for `settlePots` with multiple all-ins |
| 10 | `training/drillRecord.ts` | — | append-only log + query-based analytics |

## Key invariants (don't skip)

Before touching anything in `/packages/engine` or `/packages/math`:
- Read `docs/invariants.md` in full — especially the **Rejected** blocks.
  Several "obviously correct" simplifications are wrong; the counter-examples
  are literal test cases.
- Read the relevant section of `SPEC.md` for module boundaries.

## Repo state at step 1 completion

```
packages/
  engine/src/cards.ts       — Card, Rank, Suit, parseCard, freshDeck, shuffleDeck
  engine/src/index.ts       — re-exports
  math/src/handEvaluator.ts — HandCategory, HandRank, rank(), compareHandRank()
  math/src/index.ts         — re-exports
  math/test/handEvaluator.test.ts — 54 tests, all green
```

No `gameState.ts`, `kernel.ts`, `pots.ts`, or `training/` yet.
