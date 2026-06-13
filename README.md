# count-the-outs

Texas Hold'em poker engine + training library. Pure TypeScript, no dependencies beyond the monorepo itself. Teaches decisions that are provably correct under stated assumptions (EV/equity), clearly distinguished from decisions graded against curated reference ranges.

## Packages

| Package | What it does |
|---------|-------------|
| `@count-the-outs/engine` | Game state, legal-move enforcement, pot settlement, hand lifecycle |
| `@count-the-outs/math` | Hand evaluation, range parsing, exact/Monte Carlo equity |
| `@count-the-outs/training` | Scenario building, drill grading policies, drill logging and analytics |

## Setup

```sh
pnpm install
pnpm test          # 317 tests, all packages
```

Requires Node ≥ 18, pnpm ≥ 8.

---

## engine

### Running a hand

```ts
import {
  startHand, endHand, nextButton,
  attempt, apply, deriveNext,
  currentActor, handTerminal, legalActions,
  payouts,
} from '@count-the-outs/engine';
import { rank } from '@count-the-outs/math';

const table = {
  id: 'table-1',
  seatOrder: ['alice', 'bob'],
  buttonSeat: 'alice',
  bigBlind: 100,
  stacks: new Map([['alice', 1000], ['bob', 1000]]),
};

// Deal a hand
let state = startHand(table);

// Post blinds (heads-up: button posts SB, other posts BB)
state = apply(state, { kind: 'BlindPosted', playerId: 'alice', amount: 50 });
state = apply(state, { kind: 'BlindPosted', playerId: 'bob',   amount: 100 });

// Assign hole cards
state = apply(state, {
  kind: 'HoleCardsDealt',
  hands: new Map([
    ['alice', { cards: [parseCard('Ah'), parseCard('Kd')] }],
    ['bob',   { cards: [parseCard('7c'), parseCard('2h')] }],
  ]),
});

// Action loop
while (!handTerminal(state)) {
  const actor = currentActor(state);
  if (!actor) { state = deriveNext(state); continue; }

  const legal = legalActions(state, actor);
  // legal.canCheck / legal.canFold / legal.callAmount / legal.minRaise / legal.maxRaise

  // Submit a decision
  const result = attempt(state, { kind: 'Call', playerId: actor });
  if (!result.ok) throw new Error(result.error);
  for (const ev of result.events) state = apply(state, ev);
}

// Settle pots
const payout = payouts(state, (ids, board) => {
  // supply a BestHandFn — rank() from @count-the-outs/math works here
  return ids.reduce((best, id) => {
    const player = state.players.find(p => p.id === id)!;
    const cards = [...player.holeCards!.cards, ...board];
    const r = rank(cards);
    if (!best || r.category > best.rank.category) return { winnerId: id, rank: r };
    return best;
  }, null as { winnerId: string; rank: ReturnType<typeof rank> } | null)?.winnerId
    ? [best.winnerId] : ids;
  // simplified — see pots.ts for full BestHandFn signature
});

// End the hand; get updated stacks
const nextTable = endHand(table, state, payout);
const nextTable2 = { ...nextTable, buttonSeat: nextButton(nextTable) };
```

### Key types

```ts
// Commands (what players submit)
{ kind: 'Check',   playerId: string }
{ kind: 'Fold',    playerId: string }
{ kind: 'Call',    playerId: string }
{ kind: 'RaiseTo', playerId: string; amount: number }
{ kind: 'PostBlind', playerId: string; amount: number }

// Predicates
currentActor(state)           // PlayerId | null — who must act next
legalActions(state, playerId) // { canCheck, canFold, callAmount, minRaise, maxRaise }
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
compareHandRank(r1, r2); // 1 | 0 | -1
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
import { parseCard } from '@count-the-outs/engine';

const ctx = {
  heroId: 'alice',
  players: [
    { id: 'alice', holeCards: [parseCard('Ah'), parseCard('Kh')] },
    { id: 'bob',   range: parseRange('QQ+, AKs') },
  ],
  board: [parseCard('Qh'), parseCard('Jh'), parseCard('2c')],
};

const result = compute(ctx);
result.equity.get('alice'); // e.g. 0.42
result.method;              // 'exact' | 'montecarlo'
result.stderr;              // max Bernoulli stderr (MC only)
// Uses exact enumeration when product of range sizes × board combinations ≤ 200k,
// otherwise Monte Carlo.
```

---

## training

### Build a scenario

```ts
import { buildScenario } from '@count-the-outs/training';

const state = buildScenario({
  seatOrder: ['hero', 'villain'],
  buttonSeat: 'hero',
  bigBlind: 100,
  stacks: new Map([['hero', 1000], ['villain', 1000]]),
  steps: [
    { kind: 'PostBlind', playerId: 'hero',    amount: 50 },
    { kind: 'PostBlind', playerId: 'villain', amount: 100 },
    { kind: 'HoleCardsDealt', hands: new Map([
      ['hero',    { cards: [parseCard('Ah'), parseCard('Kd')] }],
      ['villain', { cards: [parseCard('Qc'), parseCard('Qh')] }],
    ])},
    { kind: 'RaiseTo', playerId: 'hero',    amount: 300 },
    { kind: 'Call',    playerId: 'villain' },
    { kind: 'BoardCardsRevealed', cards: [parseCard('As'), parseCard('2h'), parseCard('7c')] },
  ],
});
// state is now on the flop, hero has top pair top kicker, villain has an overpair
```

### Grade a decision

**EquityPolicy** — correct if hero equity is above/below pot-odds break-even:

```ts
import { EquityPolicy } from '@count-the-outs/training';
import { compute, parseRange } from '@count-the-outs/math';

const policy = new EquityPolicy('hero');
const ctx = {
  heroId: 'hero',
  players: [
    { id: 'hero',    holeCards: [parseCard('Ah'), parseCard('Kd')] },
    { id: 'villain', range: parseRange('QQ, AA') },
  ],
  board: state.board,
};

const verdict = policy.evaluate(state, { kind: 'Call', playerId: 'hero' }, ctx);
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
import { RangePolicy, PREFLOP_RANGES } from '@count-the-outs/training';

const policy = new RangePolicy('hero', 'BTN_open', 'raise');
const verdict = policy.evaluate(state, { kind: 'RaiseTo', playerId: 'hero', amount: 250 });
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
  userAction: { kind: 'Call', playerId: 'hero' },
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
