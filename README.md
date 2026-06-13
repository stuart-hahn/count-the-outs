# count-the-outs

Texas Hold'em poker engine + training library. Pure TypeScript, no dependencies beyond the monorepo itself. Teaches decisions that are provably correct under stated assumptions (EV/equity), clearly distinguished from decisions graded against curated reference ranges.

## Packages

| Package | What it does |
|---------|-------------|
| `@count-the-outs/engine` | Game state, legal-move enforcement, pot settlement, hand lifecycle |
| `@count-the-outs/math` | Hand evaluation, range parsing, exact/Monte Carlo equity |
| `@count-the-outs/training` | Scenario building, drill grading policies, drill logging and analytics |
| `@count-the-outs/cli` | Interactive preflop drill runner (`pnpm drill`) |

## Setup

```sh
pnpm install
pnpm test          # 317 tests, all packages
```

Requires Node ≥ 18, pnpm ≥ 8.

---

## CLI drill runner

```sh
pnpm drill                              # 20 random preflop drills
pnpm drill -- --count 10               # 10 drills
pnpm drill -- --spot BTN_open          # one spot only, 20 drills
pnpm drill -- --count 5 --spot UTG_open
```

Each drill shows your position, the hand dealt, and asks whether to take the reference action or fold. Verdict prints immediately with an explanation. Session summary at the end (or on Ctrl+C).

```
[1/20] BTN open
Hand: AKs
[r]aise / [f]old: r
✓ AKs is in BTN_open (weight 1.00). RaiseTo is correct.

[2/20] BB defend vs CO
Hand: 72o
[c]all / [f]old: c
✗ 72o is not in BB_defend_vs_CO (weight 0.00). Call is incorrect.

Session: 15/20 correct (75.0%)
```

**Available spots:**

| Spot | Hero | Decision |
|------|------|----------|
| `UTG_open` | UTG | raise or fold |
| `HJ_open` | HJ | raise or fold |
| `CO_open` | CO | raise or fold |
| `BTN_open` | BTN | raise or fold |
| `SB_open` | SB | raise or fold |
| `BB_defend_vs_BTN` | BB | call or fold |
| `BB_defend_vs_CO` | BB | call or fold |
| `BB_defend_vs_SB` | BB | call or fold |
| `BTN_3bet_vs_CO` | BTN | raise (3bet) or fold |
| `SB_3bet_vs_BTN` | SB | raise (3bet) or fold |
| `BB_3bet_vs_BTN` | BB | raise (3bet) or fold |
| `BB_3bet_vs_CO` | BB | raise (3bet) or fold |

Verdicts are graded against heuristic 6-max ranges (medium confidence). Stack depth is fixed at 100BB.

---

## engine

### Running a hand

```ts
import {
  startHand, endHand,
  attempt, apply, deriveNext,
  currentActor, handTerminal, legalActions,
  parseCard,
} from '@count-the-outs/engine';
import type { BestHandFn } from '@count-the-outs/engine';

const table = {
  handNumber: 1,
  seatOrder: ['alice', 'bob'],
  buttonSeat: 'alice',
  bigBlind: 100,
  stacks: new Map([['alice', 1000], ['bob', 1000]]),
};

let state = startHand(table);

// Post blinds — engine determines who posts from game state
for (const amount of [50, 100]) {
  const result = attempt(state, { kind: 'PostBlind', amount });
  if (!result.ok) throw new Error(result.error);
  for (const ev of result.events) state = apply(state, ev);
}

// Assign hole cards (TransitionEvent injected directly)
state = apply(state, { kind: 'HoleCardsAssigned', player: 'alice', cards: [parseCard('Ah'), parseCard('Kd')] });
state = apply(state, { kind: 'HoleCardsAssigned', player: 'bob',   cards: [parseCard('7c'), parseCard('2h')] });

// Action loop
while (!handTerminal(state)) {
  const actor = currentActor(state);
  if (!actor) { state = deriveNext(state); continue; }

  const legal = legalActions(state, actor);
  // legal.canCheck, legal.canFold, legal.canCall
  // legal.callAmount, legal.raiseMin, legal.raiseMax

  const result = attempt(state, { kind: 'Call' });
  if (!result.ok) throw new Error(result.error);
  for (const ev of result.events) state = apply(state, ev);
}

// Settle pots and advance the table
import { rank, compareHandRank } from '@count-the-outs/math';

const bestHand: BestHandFn = (playerIds, board) => {
  const ranked = playerIds.map(id => {
    const p = state.players.find(p => p.id === id)!;
    return { id, r: rank([...p.holeCards!.cards, ...board]) };
  }).sort((a, b) => compareHandRank(b.r, a.r));
  const top = ranked[0]!.r;
  return ranked.filter(x => compareHandRank(x.r, top) === 0).map(x => x.id);
};

const nextTable = endHand(table, state, bestHand);
```

### Key types

```ts
// Commands (what players submit — no playerId field; engine resolves actor from state)
{ kind: 'Check' }
{ kind: 'Fold' }
{ kind: 'Call' }
{ kind: 'RaiseTo'; amount: number }
{ kind: 'PostBlind'; amount: number }

// Predicates
currentActor(state)           // PlayerId | null — who must act next
legalActions(state, playerId) // { canCheck, canFold, canCall, callAmount, raiseMin, raiseMax }
handTerminal(state)           // boolean — hand is over
bettingRoundComplete(state)   // boolean — street action is closed
```

---

## math

### Hand evaluation

```ts
import { rank, compareHandRank, HandCategory } from '@count-the-outs/math';
import { parseCard } from '@count-the-outs/engine';

const cards = ['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '7d'].map(parseCard);
const r = rank(cards); // picks best 5 from 7
r.category; // HandCategory.StraightFlush
compareHandRank(r1, r2); // positive if r1 > r2, 0 if tie, negative if r1 < r2
```

### Range parsing

```ts
import { parseRange, effectiveRange } from '@count-the-outs/math';

const range = parseRange('QQ+, AKs, AQo+, KQs:0.5');
// Handles: pairs (TT+), suited (AKs), offsuit (AKo), both (AK),
//          plus-ranges (QQ+), dash-ranges (KQs-KTs), weight modifiers (:0.5),
//          comma/space-separated lists.

// Remove dead cards (board + known opponent cards)
const board = ['Ah', 'Kd', '7c'].map(parseCard);
const live = effectiveRange(range, board);
```

### Equity

```ts
import { compute } from '@count-the-outs/math';
import { parseRange } from '@count-the-outs/math';

const ctx = {
  state,           // GameState — provides board and player hole cards
  observer: 'alice',
  assumptions: new Map([
    ['bob', parseRange('QQ+, AKs')],
  ]),
};

const result = compute(ctx);
result.equity.get('alice'); // e.g. 0.42
result.method;              // { type: 'Exact' } | { type: 'MonteCarlo', samples, stderr }
// Uses exact enumeration when combos × runouts ≤ 200k, otherwise Monte Carlo (10k samples).
```

---

## training

### Build a scenario

Steps are a flat list of `Command | TransitionEvent`. Commands (`PostBlind`, `Fold`, `Call`, `RaiseTo`, `Check`) are validated by the engine — the actor is determined from game state, not specified in the command. TransitionEvents (`HoleCardsAssigned`, `BoardCardsRevealed`, etc.) are applied directly.

```ts
import { buildScenario } from '@count-the-outs/training';
import { parseCard } from '@count-the-outs/engine';

const state = buildScenario({
  seatOrder: ['hero', 'villain'],
  buttonSeat: 'hero',
  bigBlind: 100,
  stacks: new Map([['hero', 1000], ['villain', 1000]]),
  steps: [
    { kind: 'PostBlind', amount: 50 },
    { kind: 'PostBlind', amount: 100 },
    { kind: 'HoleCardsAssigned', player: 'hero',    cards: [parseCard('Ah'), parseCard('Kd')] },
    { kind: 'HoleCardsAssigned', player: 'villain', cards: [parseCard('Qc'), parseCard('Qh')] },
    { kind: 'RaiseTo', amount: 300 },  // hero (BTN/SB) raises
    { kind: 'Call' },                  // villain (BB) calls
    { kind: 'BoardCardsRevealed', street: 'flop', cards: [parseCard('As'), parseCard('2h'), parseCard('7c')] },
  ],
});
// state is now on the flop, villain to act
```

### Grade a decision

**EquityPolicy** — correct if hero equity is above/below pot-odds break-even:

```ts
import { EquityPolicy } from '@count-the-outs/training';
import { parseRange } from '@count-the-outs/math';

const policy = new EquityPolicy('hero');
const ctx = {
  state,
  observer: 'hero',
  assumptions: new Map([['villain', parseRange('QQ, AA')]]),
};

const verdict = policy.evaluate(state, { kind: 'Call' }, ctx);
verdict.correct;     // boolean
verdict.score;       // 0–1
verdict.explanation; // human-readable string
```

**EVPolicy** — correct when regret (EV(best) − EV(chosen)) ≤ epsilon:

```ts
import { EVPolicy } from '@count-the-outs/training';
const policy = new EVPolicy('hero', /* epsilon */ 0, /* scale */ 'pot');
```

**RangePolicy** — grades against a curated preflop reference range:

```ts
import { RangePolicy } from '@count-the-outs/training';

const policy = new RangePolicy('hero', 'BTN_open', 'raise');
const verdict = policy.evaluate(state, { kind: 'RaiseTo', amount: 250 });
// Second arg is the spot key; third is the reference action ('raise' | 'call').
// Available spots: BTN_open, CO_open, HJ_open, UTG_open, SB_open,
//                 BB_defend_vs_BTN, BB_defend_vs_CO, BB_defend_vs_SB,
//                 BTN_3bet_vs_CO, SB_3bet_vs_BTN, BB_3bet_vs_BTN, BB_3bet_vs_CO
```

### Log and analyze drills

```ts
import {
  DrillLog, accuracy, filterByCore, leaks, trend,
} from '@count-the-outs/training';

const log = new DrillLog();

log.append({
  scenarioSpec,
  userAction: { kind: 'Call' },
  verdict,
  tags: {
    core: { position: 'BTN', street: 'flop', actionContext: 'facing-bet', stackDepth: 'deep', potType: 'single-raised' },
    aux: { source: 'equityPolicy' },
  },
  timestamp: Date.now(),
});

const records = log.all();

accuracy(records);                                      // overall avg score
accuracy(filterByCore(records, { position: 'BB' }));    // BB-only accuracy
leaks(records, 'street');                               // Map<street, avgScore> — find weak spots
trend(records, 10);                                     // sliding 10-hand average over time
```

**CoreTags taxonomy:**

| Tag | Values |
|-----|--------|
| `position` | `BTN` `CO` `HJ` `UTG` `SB` `BB` |
| `street` | `preflop` `flop` `turn` `river` |
| `actionContext` | `open` `facing-raise` `facing-3bet` `facing-bet` `facing-check` |
| `stackDepth` | `short` `medium` `deep` |
| `potType` | `single-raised` `multi-raised` `limped` `all-in` |

---

## Docs

- [`docs/SPEC.md`](docs/SPEC.md) — module map, dependency graph, build order
- [`docs/invariants.md`](docs/invariants.md) — load-bearing formulas for betting, pot settlement, payouts; read before modifying `/packages/engine`
