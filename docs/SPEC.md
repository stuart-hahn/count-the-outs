# Poker Engine + Training System — Architecture Spec

## Purpose

A structurally-sound poker engine, a pure-combinatorics math engine, and a
training/drill system layered on top — all sharing one canonical `GameState`
representation. End goal: drills that teach decisions provably correct under
stated assumptions (EV/equity), clearly distinguished from drills that compare
against curated-but-approximate reference ranges (RangePolicy).

This document is the canonical reference for module boundaries and build
order. `invariants.md` is the canonical reference for the *rules themselves*
(formulas, predicates, rejected alternatives + why). Any AI agent working on
`/engine` MUST read `invariants.md` first — several "obviously correct"
simplifications of these formulas are wrong in specific, non-obvious ways
that have already been found and fixed once.

## Module map

```
engine    - GameState, Command/Event, attempt/apply/derive, kernel predicates,
            settlePots, payouts, TableState/hand lifecycle
            depends on: nothing (pure domain core)

math      - HandEvaluator, Range, equity computation
            depends on: engine's GameState *shape* only (reads state,
            never calls engine logic)

training  - ScenarioBuilder, EvaluationPolicy, Verdict, DrillRecord, analytics
            depends on: engine + math
```

Dependency direction is strictly one-way: `engine` knows nothing about
`math` or `training`. `math` knows nothing about `training`. This mirrors
the "GameState = facts, AnalysisContext = beliefs, EvaluationPolicy =
grading" separation established in invariants.md.

## Repo layout

```
/packages
  /engine
    src/
      cards.ts            # Card, Deck (orchestrator-owned, not used by engine logic)
      gameState.ts        # GameState, PlayerState types
      transitions.ts       # Command, Event types
      kernel.ts           # attempt, apply, derive, needsToAct, currentActor,
                           # legalActions, bettingRoundComplete, handTerminal
      pots.ts             # settlePots, winners, payouts
      table.ts            # TableState, startHand, endHand, nextButton
    test/
      kernel.test.ts       # formula-driven test table (see invariants.md)
      pots.test.ts
  /math
    src/
      handEvaluator.ts     # naive 7-card evaluator, oracle
      range.ts             # Range type, parseRange, effectiveRange
      equity.ts            # exact + Monte Carlo
    test/
      handEvaluator.test.ts  # exhaustive category/tiebreak coverage
      equity.test.ts
  /training
    src/
      scenarioBuilder.ts   # ScenarioSpec -> GameState via engine pipeline
      policies.ts          # EVPolicy, EquityPolicy, RangePolicy, etc.
      drillRecord.ts        # log + query helpers
      ranges/               # curated reference range data (heuristic, tagged)
    test/
      policies.test.ts
/docs
  SPEC.md
  invariants.md
/AGENTS.md (or CLAUDE.md)
```

## Build order (matches original roadmap)

1. `engine/cards.ts` + `math/handEvaluator.ts` — exhaustive correctness tests
   first (category boundaries, wheel straight, kicker ordering, ties).
2. `engine/gameState.ts` + `transitions.ts` + `kernel.ts` (heads-up only,
   single pot) — formula-driven test table first, then implementation.
3. `engine/pots.ts` — `settlePots`/`payouts`, tested standalone with
   hand-constructed commitment/fold tables (still single-pot in practice
   for heads-up, but implementation is general from day one).
4. `engine/table.ts` — hand lifecycle, heads-up button toggle.
   -> **checkpoint: playable heads-up NLHE loop, single pot.**
5. `math/range.ts` + `math/equity.ts` — Range parsing, card removal, exact/MC
   equity. Independent of `training`.
6. `training/scenarioBuilder.ts` + `policies.ts` (EVPolicy, EquityPolicy
   first — pure combinatorics, no reference data needed)
   -> **checkpoint: pot-odds / equity drills working.**
7. `training/ranges/` + `RangePolicy` — author ~10-20 heuristic reference
   ranges, provenance-tagged.
   -> **checkpoint: preflop open/3bet drills working.**
8. Generalize `seatOrder`/`buttonSeat`/`nextButton` to N=3-6 (kernel
   predicates already general — this is mostly `TableState` + UI).
9. Multi-pot stress test — exercise `settlePots` with multiple all-ins at
   different stack depths; extensive regression suite (per original
   roadmap step 7).
10. `training/drillRecord.ts` — append-only log + query-based analytics.

Each numbered step = its own PR, CI green before the next starts. No step
requires reworking a prior step's interfaces (verified during design — see
invariants.md "dependency notes" per section).

## Explicitly out of scope (do not implement unless revisiting this doc)

- GTO/equilibrium solving (`SolverPolicy` is a future stub only)
- "Equity realization" / full multi-street EV (`ExploitPolicy` future stub)
- Hand continuation after a drill `Verdict` (`OpponentPolicy` + range
  sampling — separate future subsystem)
- Lookup-table hand evaluator (only if profiling demonstrates need)
- Licensed/solver-derived range charts (self-authored heuristics only)
