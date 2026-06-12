# Engine Invariants

Canonical rules for `/packages/engine` (and the parts of `/math`/`/training`
that depend on `GameState` shape). Each section: **Rule** (implement this),
**Rejected** (looked plausible, is wrong, with the counter-example that
disproved it). When in doubt, the counter-examples ARE test cases — encode
them literally in `kernel.test.ts` / `pots.test.ts`.

---

## 1. GameState contains facts only

```
GameState {
  id, variant, street: Preflop|Flop|Turn|River
  seatOrder: PlayerId[]      // fixed table permutation, persisted fact
  buttonSeat: PlayerId       // persisted fact, set at hand start

  // street-level, reset on street transition (section 5)
  currentBetLevel: Amount
  lastFullBetLevel: Amount
  lastFullRaiseIncrement: Amount

  players: PlayerState[]
  board: Card[]
  history: TransitionEvent[]  // canonical; see section 2
}

PlayerState {
  id, seat
  stack: Amount
  committedThisStreet: Amount
  folded: bool
  holeCards: Assigned(Card,Card) | <absent>   // section 3
  seen: Amount   // = lastFullBetLevel as of this player's last action
}
```

**Rejected:** storing `currentActor`, `legalActions`, `status`
(Active/AllIn/Folded), `pots`, `winners`, `payouts`, `availableActions` on
`GameState`. All are pure functions of the above (sections 4, 6, 7). Storing
them creates a second source of truth that can desync.

`status(p)`: `Folded` if `folded`; else `AllIn` if `stack==0`; else
`Eligible`. Derived, not stored.

---

## 2. Transitions: Command vs Event, attempt/apply/derive

```
attempt(state, command) -> Result<Event[], IllegalCommand>
apply(state, event) -> state          // ~0 poker logic, total function
deriveNext(state) -> Event(e) | NeedsInput(req) | None
```

- **Commands** = intent, can fail (`Check, Fold, Call, RaiseTo(amount),
  PostBlind(amount)`).
- **Events** = facts, never fail, replayed via `apply` for determinism:
  `BlindPosted, HoleCardsAssigned, ActionAccepted, ChipsCommitted,
  BoardCardsRevealed(street,cards), CardsShown, CardsMucked`.
- `ActionAccepted(player, command)` (intent, audit/training use) is paired
  with `ChipsCommitted(player, amount)` (resolved effect, `apply` uses this).
  `Check`/`Fold` need no `ChipsCommitted`.

**Derive loop** (orchestrator):
```
attempt -> events; apply each
loop:
  match deriveNext(state):
    Event(e)      -> apply(e); continue
    NeedsInput(r) -> orchestrator.resolve(r) -> event -> apply(e); continue
    None          -> done
```
`deriveNext` only emits state-derivable events
(`BettingRoundClosed`-equivalent transitions — see section 5 reset). It
emits `NeedsInput(Reveal(street,n))` when a card reveal is needed; only the
orchestrator supplies concrete cards (deck for live play, script for drills).

**Replay:** `state = fold(apply, initialState, history)`. Deterministic,
no validation needed (events are canonical).

**Rejected:** persisting `BettingRoundClosed, StreetAdvanced, PotsComputed,
HandEvaluated, PotAwarded, HandCompleted` as events. All are queries
(`street(state)`, `isTerminal(state)`, `pots(state)`, `payouts(state)`).
Persisting them risks divergence from the reducer/eval logic after bugfixes
(see versioning, section 9).

---

## 3. Hole cards: Assigned / absent / Hidden

```
holeCards[p] := last HoleCardsAssigned(p) in history, else <absent>
```

`<absent>` is the *default* (no event), not an event. `Unassigned` is never
itself an event.

- **Decision drills** (no showdown query): opponents may stay `<absent>`
  forever. `AnalysisContext.assumptions[p] = Range` supplies what `math`
  needs — independent of `holeCards`.
- **Full-hand-replay drills** (showdown reachable): every non-folded player
  at the terminal state MUST have `Assigned` holeCards, else `bestHand`/
  `payouts` undefined. This is a **ScenarioSpec validity constraint**,
  checked at spec-build time, not a runtime engine concern.
- `CardsShown(p)` requires `holeCards[p]` already `Assigned`.

**Projection** (visibility, not state):
```
projectFor(state, observer)[p].holeCards :=
  if p == observer: Assigned(...)            // always own cards
  elif CardsShown(p) in history: Assigned(...)  // voluntarily shown
  elif holeCards[p] == <absent>: <absent>
  else: Hidden
```
`Hidden` exists only in projected views, never in canonical `GameState`.
Because `state` at any history-prefix only reflects events up to that point,
`projectFor` is correct for live play (mid-hand) without any extra
"as-of-time-T" machinery — just project the state-as-of-T.

**Rejected:** `holeCards: Known | Unknown` as a single enum collapsing
"fact doesn't exist" (drill, unassigned) and "fact exists but hidden from
this viewer" (live opponent). These have different implications (the latter
requires `Assigned` to exist for `CardsShown`/showdown; the former doesn't
and never will in that spec).

---

## 4. Kernel predicates (the load-bearing formulas)

```
requiresAction(p) := !folded(p) && stack(p) > 0

reopened(p) := seen(p) < lastFullBetLevel

needsToAct(p) :=
    requiresAction(p)
    && ( committed(p) < currentBetLevel   // chip deficit
         || reopened(p) )                 // decision deficit

bettingRoundComplete(state) := ∄p: needsToAct(p)

currentActor(state) :=
    lastActor := player of most recent ActionAccepted in history (this street), or null
    start := nextSeat(lastActor) if lastActor else firstToAct(street)
    first p in seatOrder, scanning from start (wrap), where needsToAct(p)
    // if none: bettingRoundComplete is true, derive advances street

firstToAct(street) :=
    Preflop:  seatAfter(BB)
    Postflop: seatAfter(Button)
    // heads-up reversal (button acts first preflop, last postflop)
    // falls out automatically: with 2 seats, seatAfter(BB)==Button and
    // seatAfter(Button)==BB. No special case.

eligibleForPot(p) := !folded(p)   // all-in players remain eligible

handTerminal(state) :=
    count(p where eligibleForPot(p)) <= 1
    || (street == River && bettingRoundComplete(state))
```

**Currency of `seen`:** updated on EVERY voluntary action (`Check`, `Call`,
`RaiseTo` full or short) to the post-action `lastFullBetLevel`. NOT updated
by `PostBlind`.

```
on ActionAccepted(p, _):
    apply chip/state changes (incl. lastFullBetLevel update if full raise)
    seen[p] = lastFullBetLevel   // value AFTER this action
```

### Rejected formulations (in order found, each broke a real scenario)

1. **`status==Active` in `bettingRoundComplete`** — Rejected: persisting
   `status` creates a second source of truth vs `folded`/`stack`. Use
   `requiresAction` (derived) instead.

2. **`needsToAct := !folded && committed < currentBetLevel`** (drop `seen`)
   — Rejected: heads-up, SB=10/BB=20, SB calls (`committed=20=currentBetLevel`
   for both). `needsToAct(BB)=false` for both players →
   `bettingRoundComplete=true` immediately → **BB never gets its option.**
   `seen` is required: `seen[BB]=0 != lastFullBetLevel=20` keeps
   `needsToAct(BB)=true` until BB actually acts.

3. **`needsToAct := requiresAction && (committed<currentBetLevel ||
   seen<lastFullBetLevel)`** (drop `requiresAction`'s `stack>0` half,
   i.e. just `!folded`) — Rejected: 3-way, A bets 100, B all-in for 30
   (short, `stack[B]=0`, `committed[B]=30<100`), C calls 100.
   `needsToAct(B)=true` forever (`stack=0` means B can never resolve the
   deficit) → `bettingRoundComplete` never true → **deadlock / blocks
   all-in run-out cascade.** `stack>0` gate is mandatory.

4. **"empty raise range" needing a separate singleton/collapse branch for
   short all-in raises** — Rejected as over-complicated; folded into a
   single inequality (section 6) instead — but the *constraint itself*
   (full-raise-or-all-in) must not be dropped (see section 6 rejection).

---

## 5. Street transitions

Triggered when `bettingRoundComplete(state)` and `street != River` (and
`!handTerminal`):
```
street += 1
currentBetLevel = 0
lastFullBetLevel = 0
lastFullRaiseIncrement = BB
∀p: committedThisStreet = 0
∀p: seen = 0
-> deriveNext emits NeedsInput(Reveal(street, cardCount))
```

After reset, if all remaining `eligibleForPot` players have `stack==0`
(all-in), `needsToAct=∅` immediately post-reset →
`bettingRoundComplete=true` again → cascades through remaining streets via
repeated `NeedsInput(Reveal)` until River. **This is the all-in run-out —
no special-case branch.**

---

## 6. RaiseTo legality (single expression)

```
toCall = currentBetLevel - committed(p)
maxTo  = committed(p) + stack(p)

Check:  toCall == 0
Call:   toCall > 0     // amount = min(toCall, stack(p)), resolved by attempt
Fold:   always (if it's p's turn)

RaiseTo(x) legal iff:
    currentBetLevel < x <= maxTo
    && ( x - currentBetLevel >= lastFullRaiseIncrement   // full raise
         || x == maxTo )                                  // short all-in escape hatch

isFullRaise(x) := x - currentBetLevel >= lastFullRaiseIncrement
  if isFullRaise: lastFullBetLevel = x; lastFullRaiseIncrement = x - currentBetLevel
  else (short all-in): lastFullBetLevel, lastFullRaiseIncrement unchanged
```

### Rejected formulations

1. **`x ∈ [minTo,maxTo]` with separate singleton-collapse for
   `maxTo<minTo`** — not wrong, just two branches; collapsed into the
   single OR-expression above (equivalent).

2. **Dropping the full-raise-or-allin constraint entirely
   (`x>currentBetLevel && x<=maxTo`, no lower bound at all)** — Rejected:
   `currentBetLevel=100, lastFullRaiseIncrement=100` (min raise to 200),
   player has `maxTo=1100` (plenty of chips). This rule allows
   `RaiseTo(150)` — a non-all-in short raise — which is **illegal in
   NLHE**. The `x==maxTo` clause must remain as the *only* escape from the
   full-raise minimum, and is only reachable/relevant when
   `maxTo < currentBetLevel+lastFullRaiseIncrement`.

### Opening bet (currentBetLevel==0)
Subsumed automatically: after street reset, `lastFullRaiseIncrement=BB`, so
`isFullRaise(x) := x >= BB` — i.e. minimum open = BB, no special case.

### Blinds (PostBlind)
```
init after blinds:
  currentBetLevel = BB
  lastFullBetLevel = BB
  lastFullRaiseIncrement = BB
  ∀p (including posters): seen = 0

PostBlind(p, amount):
  -> ChipsCommitted(p, amount); committedThisStreet += amount
  -> does NOT update seen[p]
```
This single rule produces both: SB facing BB sees `reopened(SB)=true`
(correct, full options), and BB sees `seen[BB]=0 < lastFullBetLevel=BB` →
`reopened(BB)=true` with `committed(BB)==currentBetLevel` → `{Check,
RaiseTo}` — **the BB option**, with zero special-case code.

---

## 7. Pots and payouts

```
Pot { id, amount, eligible: Set<PlayerId> }   // no main/side distinction

settlePots(commitments: Map<PlayerId,Amount>, folded: Set<PlayerId>) -> Pot[]
  // layer-stripping over distinct commitment levels L:
  layer L: amount   = Σ_i min(commitment_i, L) - prevL
           eligible = { i | commitment_i >= L && i ∉ folded }

payouts(state):
  for pot in pots(state):
    ws = bestHand(pot.eligible, board)              // ties possible
    share = floor(pot.amount / |ws|)
    rem   = pot.amount mod |ws|
    order = seatOrder rotated to start at seatAfter(buttonSeat), filtered to ws
    for i,p in enumerate(order):
        payout[p] += share + (1 if i < rem else 0)
```

`commitments` = `totalCommitted[p]` = sum of all `ChipsCommitted(p,_)` across
the whole hand (derive by summing history; not needed for legality, only at
terminal — no O(1) requirement).

Per-pot remainder distribution is independent — different pots can give the
odd chip to different players depending on each pot's `eligible` set and
seat order.

**Rejected:** persisting `PotsComputed`/`PotAwarded`/`HandEvaluated` as
events — pure queries (section 2).

---

## 8. TableState / hand lifecycle

```
TableState { seatOrder, buttonSeat, stacks: Map<PlayerId,Amount>, handNumber }

startHand(table) -> GameState
  stacks <- table.stacks (as initial PlayerState.stack, committed=0)
  buttonSeat <- table.buttonSeat
  blinds posted relative to buttonSeat (section 6)
  holeCards <- <absent> (resolved via NeedsInput at deal time)

endHand(table, finalState) -> TableState
  table.stacks += payouts(finalState)
  table.buttonSeat <- nextButton(seatOrder, buttonSeat, activePlayers)
  table.handNumber += 1
  // players with stack==0 removed/Eliminated

nextButton := first seat after currentButton (seatOrder, wrapping) where stack>0
```

`GameState` = single hand, ephemeral. Only `TableState` persists across
hands. **Drills bypass `TableState` entirely** — `ScenarioBuilder` produces
a `GameState` directly (section 10), no button rotation or stack carryover
unless explicitly authored into the spec.

---

## 9. Versioning

```
persisted: (history, rulesetId)
queries:   reduce(history, rulesetId) -> GameState
           payouts(state, rulesetId)
```
If `bestHand`/`payouts` logic changes (bugfix), old history replayed under
new `rulesetId` may diverge from what was actually paid historically. This
is treated as *intentional* ("replay = re-judge under current rules") unless
a specific audit need arises — not solved preemptively.

---

## 10. ScenarioSpec (drills)

```
ScenarioSpec = TransitionHistory prefix  // Command|Event sequence
ScenarioBuilder(spec) -> GameState   // via the SAME attempt/apply/derive
                                       // pipeline as live play
```

**No alternative entry point.** No `ScenarioBuilder(stateSnapshot)` /
direct-state-injection. Because the spec is executable history,
`currentActor`, `legalActions`, `seen`, `lastFullBetLevel`, etc. all emerge
correctly with zero drill-specific logic in the kernel. Impossible states
are unreachable by construction (no solver needed).

Opponents' `HoleCardsAssigned` are simply omitted for decision drills
(section 3).

**v1 scope:** drill ends at `Verdict` (section 12). No continuation
(`applyAction(heroChoice)` after `Verdict` is undefined in v1). Continuation
would require `OpponentPolicy` + range-sampling (`Unassigned -> Assigned`
via sampling from `AnalysisContext.assumptions`) — both are new subsystems,
explicitly deferred, and don't require reworking anything above.

---

## 11. Range / equity (math package)

```
Range = Map<Combo, Weight>          // canonical; Weight unnormalized OK
parseRange(notation) -> Range        // authoring layer only

effectiveRange(R, deadCards) := { (c,w) ∈ R | c ∩ deadCards == ∅ }
P(c | R, dead) := w(c) / Σ_{k ∈ effectiveRange(R,dead)} w(k)
```

**Rejected:** renormalizing category proportions after card removal
(e.g. "AA still 1/3 of range after blockers"). Card removal IS a Bayesian
update; combinatorial shrinkage from blockers is real signal. Filter once,
normalize once, no pre-step.

```
AnalysisContext { state: GameState, observer, assumptions: Map<PlayerId,Range>,
                  objective, configuration }

MathEngine.compute(ctx) -> { equity: Map<PlayerId,float>,
                              method: Exact | MonteCarlo{samples, stderr} }
equity := P(win at showdown) + 0.5 * P(tie)
```

Method: exact if `|effRange1| × |effRange2| × C(unseen, remainingBoard) <= T`,
else Monte Carlo with reported `stderr`.

**Scope:** showdown equity only. NO future-betting, action-frequency, or
bet-sizing modeling (`SolverPolicy`/`ExploitPolicy` = future stubs).

---

## 12. HandEvaluator

```
HandEvaluator.rank(5..7 cards) -> HandRank   // (Category, [tiebreak...]), comparable
v1: enumerate C(7,5)=21 subsets, eval5 each, take max.
```
Naive impl = ground-truth oracle, exhaustively tested (category boundaries,
wheel straight, straight-flush-vs-flush-vs-straight, kicker order, ties).
Optimize (lookup tables) ONLY if profiling shows it's a bottleneck; any
replacement validated against the naive oracle across full domain before
adoption. `MathEngine` depends only on `HandRank` comparator semantics.

---

## 13. EvaluationPolicy / Verdict

```
interface EvaluationPolicy {
  evaluate(state, userAction, ctx?) -> Verdict
}
Verdict { correct: bool, score: float, reference: opaque, explanation: string }
```

**EVPolicy** — NOT strict argmax:
```
regret = EV(best) - EV(chosen)
correct := regret <= ε        // ε configurable per drill
score   := clamp(1 - regret/scale)   // scale = pot or EV(best)
```

**RangePolicy** — `reference` carries provenance:
```
reference: { range, source: heuristic|solver-derived|author-estimate, confidence }
```
`RangePolicy` verdicts mean "matches curated reference," never "is optimal."
Only `EVPolicy`/`EquityPolicy` (pure combinatorics, section 11) carry
provable-correctness framing.

---

## 14. DrillRecord / analytics

```
DrillRecord { scenarioSpec, userAction, verdict, tags, timestamp }  // append-only
tags = { core: fixed taxonomy (position, street, action-context,
                stack-depth bucket, pot-type bucket),
         aux: free-form key-value }

accuracy/leak/trend := pure queries (filter -> groupBy -> aggregate(score))
```
No incremental/materialized stats model — recompute on query (cheap at
10^3-10^5 records).

---

## 15. Reference range data (training package)

Self-authored heuristic ranges (no solver/licensed data), ~10-20 spots for
v1 (BTN/CO/SB open, BB defend vs BTN, BTN vs 3bet, BB vs SB steal, ...),
stored via `parseRange` into canonical `Range`, each tagged with
`source: "heuristic"` and a confidence note. Expand incrementally — adding
a spot never requires touching `RangePolicy` code.
