import { describe, expect, it } from 'vitest';
import type { Command, TransitionEvent } from '@count-the-outs/engine';
import { parseCard } from '@count-the-outs/engine';
import { parseRange } from '@count-the-outs/math';
import { buildScenario } from '../src/scenarioBuilder';
import { RangePolicy } from '../src/policies';
import { PREFLOP_RANGES } from '../src/ranges/index';
import type { RangeEntry, RangeRegistry } from '../src/ranges/index';
import type { GameState, PlayerId } from '@count-the-outs/engine';
import type { ScenarioSpec } from '../src/scenarioBuilder';

// ── helpers ───────────────────────────────────────────────────────────────────

function stateWithHoleCards(heroId: PlayerId, cards: [string, string]): GameState {
  const spec: ScenarioSpec = {
    seatOrder: ['SB', 'BB'],
    buttonSeat: 'SB',
    bigBlind: 20,
    stacks: new Map([['SB', 1000], ['BB', 1000]]),
    steps: [
      { kind: 'PostBlind', amount: 10 } satisfies Command,
      { kind: 'PostBlind', amount: 20 } satisfies Command,
      { kind: 'HoleCardsAssigned', player: heroId, cards: [parseCard(cards[0]), parseCard(cards[1])] } satisfies TransitionEvent,
    ],
  };
  return buildScenario(spec);
}

function stateNoHoleCards(): GameState {
  return buildScenario({
    seatOrder: ['SB', 'BB'],
    buttonSeat: 'SB',
    bigBlind: 20,
    stacks: new Map([['SB', 1000], ['BB', 1000]]),
    steps: [
      { kind: 'PostBlind', amount: 10 } satisfies Command,
      { kind: 'PostBlind', amount: 20 } satisfies Command,
    ],
  });
}

// Custom registry: spot 'test_open' contains only AA and AKs
const TEST_ENTRY: RangeEntry = {
  spot: 'test_open',
  range: parseRange('AA, AKs'),
  source: 'heuristic',
  confidence: 'test',
};
const TEST_ENTRY_MIXED: RangeEntry = {
  spot: 'test_mixed',
  range: parseRange('AA:0.5'),
  source: 'heuristic',
  confidence: 'test',
};
const TEST_ENTRY_DEFEND: RangeEntry = {
  spot: 'test_defend',
  range: parseRange('AA, AKs'),
  source: 'heuristic',
  confidence: 'test',
};
const TEST_REGISTRY: RangeRegistry = new Map([
  ['test_open', TEST_ENTRY],
  ['test_mixed', TEST_ENTRY_MIXED],
  ['test_defend', TEST_ENTRY_DEFEND],
]);

// ── raise spot ────────────────────────────────────────────────────────────────

describe('RangePolicy — raise spot', () => {
  const policy = new RangePolicy('SB', 'test_open', 'raise', TEST_REGISTRY);

  it('in-range hand + RaiseTo → correct=true, score=1', () => {
    // AhAd is in 'AA'
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });

  it('in-range hand + Fold → correct=false, score=0', () => {
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    expect(v.correct).toBe(false);
    expect(v.score).toBe(0);
  });

  it('out-of-range hand + Fold → correct=true, score=1', () => {
    // 7c2d is not in 'AA, AKs'
    const state = stateWithHoleCards('SB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });

  it('out-of-range hand + RaiseTo → correct=false, score=0', () => {
    const state = stateWithHoleCards('SB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(false);
    expect(v.score).toBe(0);
  });

  it('AKo (not in AKs-only range) → out of range', () => {
    // AhKs = AKo; test_open has AKs only
    const state = stateWithHoleCards('SB', ['Ah', 'Ks']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    expect(v.correct).toBe(true);
  });

  it('AKs → in range', () => {
    const state = stateWithHoleCards('SB', ['Ah', 'Kh']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(true);
  });

  it('non-raise/fold action → pass-through (correct=true, score=1)', () => {
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'Check' });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });

  it('Call action for raise spot → pass-through', () => {
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'Call' });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });
});

// ── defend (call) spot ────────────────────────────────────────────────────────

describe('RangePolicy — call spot', () => {
  const policy = new RangePolicy('BB', 'test_defend', 'call', TEST_REGISTRY);

  it('in-range hand + Call → correct=true', () => {
    const state = stateWithHoleCards('BB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'Call' });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });

  it('in-range hand + Fold → correct=false', () => {
    const state = stateWithHoleCards('BB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    expect(v.correct).toBe(false);
    expect(v.score).toBe(0);
  });

  it('out-of-range hand + Fold → correct=true', () => {
    const state = stateWithHoleCards('BB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    expect(v.correct).toBe(true);
  });

  it('out-of-range hand + Call → correct=false', () => {
    const state = stateWithHoleCards('BB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'Call' });
    expect(v.correct).toBe(false);
  });

  it('RaiseTo for call spot → pass-through', () => {
    const state = stateWithHoleCards('BB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 80 });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });
});

// ── mixed weight ──────────────────────────────────────────────────────────────

describe('RangePolicy — mixed weight', () => {
  const policy = new RangePolicy('SB', 'test_mixed', 'raise', TEST_REGISTRY);

  it('in-range at weight 0.5 + raise → correct=true (still in range)', () => {
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });

  it('reference reports actual weight', () => {
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    const ref = v.reference as { weight: number };
    expect(ref.weight).toBeCloseTo(0.5, 3);
  });
});

// ── error cases ───────────────────────────────────────────────────────────────

describe('RangePolicy — error cases', () => {
  it('unknown spot → correct=false, score=0', () => {
    const policy = new RangePolicy('SB', 'no_such_spot', 'raise', TEST_REGISTRY);
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(false);
    expect(v.score).toBe(0);
    expect(v.explanation).toContain('Unknown spot');
  });

  it('hero hole cards not assigned → correct=false, score=0', () => {
    const policy = new RangePolicy('SB', 'test_open', 'raise', TEST_REGISTRY);
    const state = stateNoHoleCards();
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(false);
    expect(v.score).toBe(0);
    expect(v.explanation).toContain('hole cards');
  });
});

// ── reference fields ──────────────────────────────────────────────────────────

describe('RangePolicy — reference fields', () => {
  it('reference contains spot, inRange, weight, source, confidence', () => {
    const policy = new RangePolicy('SB', 'test_open', 'raise', TEST_REGISTRY);
    const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    const ref = v.reference as { spot: string; inRange: boolean; weight: number; source: string; confidence: string };
    expect(ref.spot).toBe('test_open');
    expect(ref.inRange).toBe(true);
    expect(ref.weight).toBe(1);
    expect(ref.source).toBe('heuristic');
    expect(ref.confidence).toBe('test');
  });

  it('inRange=false for out-of-range hand', () => {
    const policy = new RangePolicy('SB', 'test_open', 'raise', TEST_REGISTRY);
    const state = stateWithHoleCards('SB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    const ref = v.reference as { inRange: boolean; weight: number };
    expect(ref.inRange).toBe(false);
    expect(ref.weight).toBe(0);
  });
});

// ── PREFLOP_RANGES sanity ─────────────────────────────────────────────────────

describe('PREFLOP_RANGES', () => {
  const EXPECTED_SPOTS = [
    'BTN_open', 'CO_open', 'HJ_open', 'UTG_open', 'SB_open',
    'BB_defend_vs_BTN', 'BB_defend_vs_CO', 'BB_defend_vs_SB',
    'BTN_3bet_vs_CO', 'SB_3bet_vs_BTN', 'BB_3bet_vs_BTN', 'BB_3bet_vs_CO',
  ];

  it('contains all expected spots', () => {
    for (const spot of EXPECTED_SPOTS) {
      expect(PREFLOP_RANGES.has(spot)).toBe(true);
    }
  });

  it('AhKs (AKo) is in BTN_open range', () => {
    const policy = new RangePolicy('SB', 'BTN_open', 'raise');
    const state = stateWithHoleCards('SB', ['Ah', 'Ks']);
    const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
    expect(v.correct).toBe(true);
  });

  it('7c2d is not in BTN_open range', () => {
    const policy = new RangePolicy('SB', 'BTN_open', 'raise');
    const state = stateWithHoleCards('SB', ['7c', '2d']);
    const v = policy.evaluate(state, { kind: 'Fold' });
    expect(v.correct).toBe(true);
  });

  it('AA is in every open range', () => {
    const openSpots = ['BTN_open', 'CO_open', 'HJ_open', 'UTG_open', 'SB_open'];
    for (const spot of openSpots) {
      const policy = new RangePolicy('SB', spot, 'raise');
      const state = stateWithHoleCards('SB', ['Ah', 'Ad']);
      const v = policy.evaluate(state, { kind: 'RaiseTo', amount: 60 });
      expect(v.correct).toBe(true);
    }
  });

  it('each entry has source=heuristic', () => {
    for (const [, entry] of PREFLOP_RANGES) {
      expect(entry.source).toBe('heuristic');
    }
  });
});
