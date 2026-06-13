# Build Status

Track progress against the 10-step build order in `SPEC.md`. Update this file
when a step's PR merges. Each step = its own PR, CI green before next starts.

## Steps

| # | What | Status | Notes |
|---|------|--------|-------|
| 1 | `engine/cards.ts` + `math/handEvaluator.ts` | ✅ done | 54 tests; naive C(7,5) eval; wheel straight, all category/kicker/tie cases covered |
| 2 | `engine/gameState.ts` + `transitions.ts` + `kernel.ts` | ✅ done | 52 tests; BB option, short all-in non-deadlock, non-all-in short-raise illegal, all-in run-out cascade, full hand replay pipeline; seen=-1 sentinel for fresh-street action trigger |
| 3 | `engine/pots.ts` | ✅ done | 25 tests; layer-stripping, folded-only level merge, multi-pot side pots, odd-chip seat-order priority, BestHandFn DI (engine stays pure) |
| 4 | `engine/table.ts` | ✅ done | 20 tests; TableState, startHand, endHand, nextButton; bust elimination; button rotation before elimination; bigBlind in TableState; **checkpoint: playable heads-up NLHE loop** |
| 5 | `math/range.ts` + `math/equity.ts` | ✅ done | 27 tests; parseRange (all standard notations), effectiveRange (card removal), exact enumeration ≤200k threshold, MC with stderr |
| 6 | `training/scenarioBuilder.ts` + `policies.ts` | ✅ done | 22 tests; buildScenario via attempt/apply pipeline (§10), EVPolicy (regret ≤ ε), EquityPolicy (equity vs pot-odds break-even); **checkpoint: pot-odds/equity drills** |
| 7 | `training/ranges/` + `RangePolicy` | ✅ done | 24 tests; 12 heuristic spots (5 opens, 3 BB defends, 4 3bets); RangePolicy grades Fold vs RaiseTo/Call against reference range; mixed weights surfaced in reference; **checkpoint: preflop open/3bet drills** |
| 8 | N-player generalization (3–6 seats) | ✅ done | 18 tests; fixed `nextBlindPoster` (SB=nextSeat(btn) multiway) and `firstToAct` (UTG=seatAfter(BB)); 3-player BB option, postflop ordering, bust elimination, button rotation loop; 6-player SB/BB/UTG placement |
| 9 | Multi-pot stress test | ✅ done | 41 tests; 4/5/6-player cascading all-ins, folded-only level merges (single + consecutive cascade), odd-chip independence per pot, duplicate commitment levels, chip conservation invariants (7 parameterised cases), complex showdowns with mixed winners and ties, heads-up regressions |
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

## Repo state at step 2 completion

```
packages/
  engine/src/cards.ts        — Card, Rank, Suit, parseCard, freshDeck, shuffleDeck
  engine/src/gameState.ts    — GameState, PlayerState, PlayerId, Amount, Street
  engine/src/transitions.ts  — Command, TransitionEvent
  engine/src/kernel.ts       — attempt, apply, deriveNext, all predicates + legalActions
  engine/src/index.ts        — re-exports all
  engine/test/kernel.test.ts — 52 tests, all green
```

Key implementation notes:
- `seen = -1` sentinel: "hasn't acted this street" — resolves fresh-street action trigger
  when `lastFullBetLevel = 0` (invariants §5 reset); `-1 < 0` is true so `reopened = true`.
- `BoardCardsRevealed` apply resets `seen = -1` (not 0) for each player.
- Kernel is N-player general from day one; heads-up falls out of the same formulas.

## Repo state at step 3 completion

```
packages/
  engine/src/pots.ts         — Pot, settlePots, totalCommitments, pots, BestHandFn, payouts
  engine/src/index.ts        — re-exports pots.ts additions
  engine/test/pots.test.ts   — 25 tests, all green (131 total across 3 files)
```

Key implementation notes:
- `settlePots` layer-strips over distinct commitment levels; if a level's eligible set is empty
  (all contributors folded), chips merge into the nearest previous pot with eligible players.
- `totalCommitments` sums both `BlindPosted` and `ChipsCommitted` events from history.
- `payouts` accepts `BestHandFn` by injection — engine has no math dependency (SPEC §module map).
- Odd-chip remainder distributed to seats earliest from `seatAfter(buttonSeat)` in `seatOrder`.

## Repo state at step 4 completion

```
packages/
  engine/src/table.ts        — TableState, startHand, endHand, nextButton
  engine/src/index.ts        — re-exports table.ts additions
  engine/test/table.test.ts  — 20 tests, all green (151 total across 4 files)
```

Key implementation notes:
- `TableState` includes `bigBlind` (not in spec literal, but required by `startHand`).
- `startHand` returns clean GameState (`currentBetLevel=0`); caller posts blinds via kernel.
- `endHand` stack formula: `newStack[p] = finalState.players[p].stack + payouts[p]`
  (NOT `table.stacks[p] + payouts[p]` — pre-hand stacks already "spent" committed chips).
- Button rotated **before** eliminating bust seats — wrap-around still works when button goes bust.
- Players with `stack==0` after `endHand` are removed from `seatOrder` and `stacks`.

## Repo state at step 5 completion

```
packages/
  math/src/range.ts          — Weight, Range, comboKey, keyToCombo, cardStr, effectiveRange, parseRange
  math/src/equity.ts         — AnalysisContext, EquityMethod, EquityResult, compute
  math/src/index.ts          — re-exports range.ts + equity.ts additions
  math/test/equity.test.ts   — 27 tests, all green (178 total across 5 files)
```

Key implementation notes:
- `Range = Map<string, Weight>` keyed by canonical combo string (e.g. `"As_Kh"`); higher rank first, tie-break by suit index (c=0 d=1 h=2 s=3).

## Repo state at step 6 completion

```
packages/
  training/src/scenarioBuilder.ts — ScenarioSpec, ScenarioStep, buildScenario
  training/src/policies.ts        — Verdict, EvaluationPolicy, EquityPolicy, EVPolicy
  training/src/index.ts           — re-exports
  training/test/policies.test.ts  — 22 tests, all green (200 total across 6 files)
```

Key implementation notes:
- `buildScenario(spec)` replays `Command | TransitionEvent` steps via `attempt`/`apply`; no direct state injection (invariants §10).
  Commands (Check/Fold/Call/RaiseTo/PostBlind) go through `attempt`; Events applied directly. Illegal commands throw.
- `EquityPolicy`: `correctEdge = isCall ? (equity−breakEven) : (breakEven−equity)`; `correct = correctEdge >= −ε`;
  `score = clamp(1 − regret/0.5)` where `regret = max(0, −correctEdge)`.
- `EVPolicy`: `EV(call) = equity × (pot+call) − call`; `EV(fold) = 0`; `regret = EV(best) − EV(chosen)`;
  `correct = regret ≤ ε`; `score = clamp(1 − regret/scale)` where `scale` defaults to pot size.
- `totalPot` = sum of `totalCommitments(state).values()` (BlindPosted + ChipsCommitted events from history).
- Both policies: no `ctx` → `{ correct: false, score: 0, ... }`; `callAmount == 0` or non-call/fold action → `{ correct: true, score: 1, ... }`.
- `parseRange` handles: specific combos (`AhKs`), pairs (`AA`), suited (`AKs`), offsuit (`AKo`), both (`AK`), plus ranges (`QQ+`, `ATs+`), dash ranges (`JJ-99`, `KQs-KTs`), weight modifiers (`AA:0.5`), comma/space-separated lists.
- `effectiveRange(R, deadCards)` — filter once, normalize once; no pre-step renormalization (invariants.md §11 rejected alternative).
- `compute` exact threshold = 200k (`∏|effRange_i| × C(unseen, boardNeeded)`): catches all river scenarios and small-range turn/flop; falls back to MC with reported stderr.
- Dead cards passed to `effectiveRange` = board only; inter-player card conflicts resolved during enumeration (usedKeys set).
- MC weighted sampling handles unequal combo weights; stderr = max Bernoulli stderr over all players.

## Repo state at step 7 completion

```
packages/
  training/src/ranges/index.ts   — RangeEntry, RangeRegistry, PREFLOP_RANGES
  training/src/ranges/preflop.ts — 12 heuristic spots (BTN/CO/HJ/UTG/SB opens, BB defends vs BTN/CO/SB, 3bet spots)
  training/src/policies.ts       — + RangePolicy
  training/src/index.ts          — re-exports RangeEntry, RangeRegistry, PREFLOP_RANGES, RangePolicy
  training/test/rangePolicy.test.ts — 24 tests, all green (224 total across 7 files)
```

Key implementation notes:
- `RangeEntry.source` is `'heuristic' | 'solver-derived' | 'author-estimate'`; all current entries tagged `'heuristic'`.
- `RangePolicy(heroId, spot, referenceAction, registry?)`: referenceAction is `'raise'` (open spots) or `'call'` (defend spots).
- Grading: inRange → correct iff userAction matches refAction; not-inRange → correct iff Fold. Non-rated actions pass through (correct=true, score=1).
- Mixed weights (e.g. `KQs:0.5`): hand is "in range" if weight > 0; weight reported in reference field.
- Adding a new spot = append to `preflop.ts` only; no `RangePolicy` changes needed (invariants.md §15).

## Repo state at step 8 completion

```
packages/
  engine/src/kernel.ts           — fixed nextBlindPoster + firstToAct for 3–6 players
  engine/test/kernel.test.ts     — +13 tests (N-player blind ordering, preflop/postflop actor, BB option, 6-player)
  engine/test/table.test.ts      — +5 tests (3-player startHand, endHand bust, button rotation loop, hand loop checkpoint)
  (all other files unchanged)    — 242 tests total across 7 files
```

Key implementation notes:
- `nextBlindPoster`: heads-up SB = buttonSeat; multiway (3+) SB = nextSeat(buttonSeat), BB = nextSeat(SB).
- `firstToAct` preflop: computes SB then BB then UTG = nextSeat(BB). Heads-up falls out automatically (Button=SB, nextSeat(Button)=BB, nextSeat(BB)=Button).
- All kernel predicates (needsToAct, bettingRoundComplete, currentActor, handTerminal) were already N-player general — no changes needed there.
- `table.ts` (`nextButton`, `startHand`, `endHand`) required no changes; already correct for N players.

## Repo state at step 9 completion

```
packages/
  engine/test/pots.stress.test.ts  — 41 new tests (283 total across 8 files)
  (all other files unchanged)
```

Key implementation notes:
- No implementation changes — `settlePots`/`payouts` were already correct; this step is regression coverage only.
- `bh()` helper in stress tests filters `winners` list to eligible set; use inline priority-based BestHandFn when a specific player must win each pot (not `bh()` which causes n-way ties when all are listed).
- Chip conservation checked via parameterised cases including asymmetric amounts and folded-only merge scenarios.
