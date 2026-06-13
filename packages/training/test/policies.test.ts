import { describe, expect, it } from 'vitest';
import type { Command, TransitionEvent } from '@count-the-outs/engine';
import { parseCard } from '@count-the-outs/engine';
import type { AnalysisContext } from '@count-the-outs/math';
import { parseRange } from '@count-the-outs/math';
import { buildScenario } from '../src/scenarioBuilder';
import { EquityPolicy, EVPolicy } from '../src/policies';
import type { ScenarioSpec, ScenarioStep } from '../src/scenarioBuilder';
import type { GameState } from '@count-the-outs/engine';

// ── helpers ───────────────────────────────────────────────────────────────────

function riverSpec(
  heroHole: [string, string],
  villainHole: [string, string],
  flop: [string, string, string],
  turn: string,
  river: string,
): ScenarioSpec {
  const steps: ScenarioStep[] = [
    { kind: 'PostBlind', amount: 10 } satisfies Command,
    { kind: 'PostBlind', amount: 20 } satisfies Command,
    { kind: 'HoleCardsAssigned', player: 'BB', cards: [parseCard(heroHole[0]), parseCard(heroHole[1])] } satisfies TransitionEvent,
    { kind: 'HoleCardsAssigned', player: 'SB', cards: [parseCard(villainHole[0]), parseCard(villainHole[1])] } satisfies TransitionEvent,
    { kind: 'Call' } satisfies Command,
    { kind: 'Check' } satisfies Command,
    { kind: 'BoardCardsRevealed', street: 'flop', cards: flop.map(parseCard) } satisfies TransitionEvent,
    { kind: 'Check' } satisfies Command,
    { kind: 'Check' } satisfies Command,
    { kind: 'BoardCardsRevealed', street: 'turn', cards: [parseCard(turn)] } satisfies TransitionEvent,
    { kind: 'Check' } satisfies Command,
    { kind: 'Check' } satisfies Command,
    { kind: 'BoardCardsRevealed', street: 'river', cards: [parseCard(river)] } satisfies TransitionEvent,
    { kind: 'Check' } satisfies Command,
    { kind: 'RaiseTo', amount: 30 } satisfies Command,
  ];
  return {
    seatOrder: ['SB', 'BB'],
    buttonSeat: 'SB',
    bigBlind: 20,
    stacks: new Map([['SB', 1000], ['BB', 1000]]),
    steps,
  };
}

// hero=BB wins: two pair AA+KK vs A-high
const WIN_HERO = 'AhKh';
const WIN_VILLAIN = '2c7d';
const WIN_BOARD: [string, string, string] = ['As', 'Kd', '5s'];
const WIN_TURN = '8c';
const WIN_RIVER = '9d';

// hero=BB loses: A-high vs villain two pair AA+KK
const LOSE_HERO = '2d3s';
const LOSE_VILLAIN = 'AcKc';
const LOSE_BOARD: [string, string, string] = ['Ah', 'Ks', '5h'];
const LOSE_TURN = '8d';
const LOSE_RIVER = '7c';

function makeCtx(state: GameState, heroCombo: string, villainCombo: string): AnalysisContext {
  return {
    state,
    observer: 'BB',
    assumptions: new Map([
      ['BB', parseRange(heroCombo)],
      ['SB', parseRange(villainCombo)],
    ]),
  };
}

// ── buildScenario ─────────────────────────────────────────────────────────────

describe('buildScenario', () => {
  it('creates preflop state from empty steps', () => {
    const state = buildScenario({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      bigBlind: 20,
      stacks: new Map([['A', 500], ['B', 500]]),
      steps: [],
    });
    expect(state.street).toBe('preflop');
    expect(state.players).toHaveLength(2);
    expect(state.board).toHaveLength(0);
    expect(state.history).toHaveLength(0);
  });

  it('applies PostBlind commands and updates stacks', () => {
    const state = buildScenario({
      seatOrder: ['SB', 'BB'],
      buttonSeat: 'SB',
      bigBlind: 20,
      stacks: new Map([['SB', 1000], ['BB', 1000]]),
      steps: [
        { kind: 'PostBlind', amount: 10 } satisfies Command,
        { kind: 'PostBlind', amount: 20 } satisfies Command,
      ],
    });
    expect(state.currentBetLevel).toBe(20);
    expect(state.players.find(p => p.id === 'SB')!.stack).toBe(990);
    expect(state.players.find(p => p.id === 'BB')!.stack).toBe(980);
  });

  it('applies HoleCardsAssigned events directly without attempt', () => {
    const state = buildScenario({
      seatOrder: ['SB', 'BB'],
      buttonSeat: 'SB',
      bigBlind: 20,
      stacks: new Map([['SB', 1000], ['BB', 1000]]),
      steps: [
        { kind: 'PostBlind', amount: 10 } satisfies Command,
        { kind: 'PostBlind', amount: 20 } satisfies Command,
        { kind: 'HoleCardsAssigned', player: 'BB', cards: [parseCard('Ah'), parseCard('Kh')] } satisfies TransitionEvent,
      ],
    });
    const bb = state.players.find(p => p.id === 'BB')!;
    expect(bb.holeCards).not.toBeNull();
    expect(bb.holeCards!.cards[0].rank).toBe(14);
  });

  it('advances street when BoardCardsRevealed event is applied', () => {
    const state = buildScenario({
      seatOrder: ['SB', 'BB'],
      buttonSeat: 'SB',
      bigBlind: 20,
      stacks: new Map([['SB', 1000], ['BB', 1000]]),
      steps: [
        { kind: 'PostBlind', amount: 10 } satisfies Command,
        { kind: 'PostBlind', amount: 20 } satisfies Command,
        { kind: 'Call' } satisfies Command,
        { kind: 'Check' } satisfies Command,
        { kind: 'BoardCardsRevealed', street: 'flop', cards: [parseCard('As'), parseCard('Kd'), parseCard('5s')] } satisfies TransitionEvent,
      ],
    });
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
  });

  it('throws on illegal command with descriptive error', () => {
    expect(() =>
      buildScenario({
        seatOrder: ['SB', 'BB'],
        buttonSeat: 'SB',
        bigBlind: 20,
        stacks: new Map([['SB', 1000], ['BB', 1000]]),
        steps: [
          { kind: 'PostBlind', amount: 10 } satisfies Command,
          { kind: 'PostBlind', amount: 20 } satisfies Command,
          { kind: 'RaiseTo', amount: 5 } satisfies Command,
        ],
      })
    ).toThrow('ScenarioBuilder: illegal command');
  });

  it('builds river call scenario at correct decision point', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    expect(state.street).toBe('river');
    expect(state.board).toHaveLength(5);
    expect(state.currentBetLevel).toBe(30);
    expect(state.players.find(p => p.id === 'BB')!.committedThisStreet).toBe(0);
  });
});

// ── EquityPolicy ──────────────────────────────────────────────────────────────

describe('EquityPolicy', () => {
  const policy = new EquityPolicy('BB');

  it('Call is correct when hero equity far exceeds pot odds', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    expect(v.correct).toBe(true);
    expect(v.score).toBeCloseTo(1, 1);
  });

  it('Fold is correct when hero equity far below pot odds', () => {
    const state = buildScenario(riverSpec(['2d', '3s'], ['Ac', 'Kc'], LOSE_BOARD, LOSE_TURN, LOSE_RIVER));
    const ctx = makeCtx(state, LOSE_HERO, LOSE_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Fold' }, ctx);
    expect(v.correct).toBe(true);
    expect(v.score).toBeCloseTo(1, 1);
  });

  it('Call is incorrect when hero equity far below pot odds', () => {
    const state = buildScenario(riverSpec(['2d', '3s'], ['Ac', 'Kc'], LOSE_BOARD, LOSE_TURN, LOSE_RIVER));
    const ctx = makeCtx(state, LOSE_HERO, LOSE_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    expect(v.correct).toBe(false);
    expect(v.score).toBeLessThan(0.5); // wrong call scores below midpoint
  });

  it('Fold is incorrect when hero equity far exceeds pot odds', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Fold' }, ctx);
    expect(v.correct).toBe(false);
    expect(v.score).toBeCloseTo(0, 1);
  });

  it('reference contains heroEquity and breakEven', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    const ref = v.reference as { heroEquity: number; breakEven: number };
    expect(ref.heroEquity).toBeCloseTo(1.0, 3);
    expect(ref.breakEven).toBeCloseTo(0.3, 3);
  });

  it('returns correct=true with score=1 when no bet to call (Check)', () => {
    const state = buildScenario({
      seatOrder: ['SB', 'BB'],
      buttonSeat: 'SB',
      bigBlind: 20,
      stacks: new Map([['SB', 1000], ['BB', 1000]]),
      steps: [
        { kind: 'PostBlind', amount: 10 } satisfies Command,
        { kind: 'PostBlind', amount: 20 } satisfies Command,
        { kind: 'Call' } satisfies Command,
        { kind: 'Check' } satisfies Command,
        { kind: 'BoardCardsRevealed', street: 'flop', cards: [parseCard('As'), parseCard('Kd'), parseCard('5s')] } satisfies TransitionEvent,
      ],
    });
    const v = policy.evaluate(state, { kind: 'Check' });
    expect(v.correct).toBe(true);
    expect(v.score).toBe(1);
  });

  it('returns correct=false with score=0 when no context provided', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const v = policy.evaluate(state, { kind: 'Call' });
    expect(v.correct).toBe(false);
    expect(v.score).toBe(0);
  });
});

// ── EVPolicy ──────────────────────────────────────────────────────────────────

describe('EVPolicy', () => {
  const policy = new EVPolicy('BB');

  it('Call is correct when EV(call) > 0', () => {
    // EV(call) = 1.0 × (70+30) - 30 = 70 > 0
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    expect(v.correct).toBe(true);
    expect(v.score).toBeCloseTo(1, 1);
  });

  it('Fold is correct when EV(call) < 0', () => {
    // EV(call) = 0.0 × 100 - 30 = -30 < 0; EV(fold)=0 is best
    const state = buildScenario(riverSpec(['2d', '3s'], ['Ac', 'Kc'], LOSE_BOARD, LOSE_TURN, LOSE_RIVER));
    const ctx = makeCtx(state, LOSE_HERO, LOSE_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Fold' }, ctx);
    expect(v.correct).toBe(true);
    expect(v.score).toBeCloseTo(1, 1);
  });

  it('Call is incorrect when EV(call) < 0 and regret > epsilon', () => {
    // EV(call) = -30, EV(fold)=0, regret=30
    const state = buildScenario(riverSpec(['2d', '3s'], ['Ac', 'Kc'], LOSE_BOARD, LOSE_TURN, LOSE_RIVER));
    const ctx = makeCtx(state, LOSE_HERO, LOSE_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    expect(v.correct).toBe(false);
  });

  it('Fold is incorrect when EV(call) >> 0', () => {
    // EV(call) = 70, folding has regret=70
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Fold' }, ctx);
    expect(v.correct).toBe(false);
  });

  it('score is 1 when optimal action chosen (regret=0)', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    expect(v.score).toBeCloseTo(1, 3);
  });

  it('score decreases as regret increases', () => {
    // Lose scenario: folding correct (score=1), calling wrong (score < 1)
    const state = buildScenario(riverSpec(['2d', '3s'], ['Ac', 'Kc'], LOSE_BOARD, LOSE_TURN, LOSE_RIVER));
    const ctx = makeCtx(state, LOSE_HERO, LOSE_VILLAIN);
    const foldVerdict = policy.evaluate(state, { kind: 'Fold' }, ctx);
    const callVerdict = policy.evaluate(state, { kind: 'Call' }, ctx);
    expect(foldVerdict.score).toBeGreaterThan(callVerdict.score);
  });

  it('epsilon: marginal decision within epsilon counts as correct', () => {
    // Policy with epsilon = 100 (any regret ≤ 100 is "correct")
    const lenientPolicy = new EVPolicy('BB', 100);
    const state = buildScenario(riverSpec(['2d', '3s'], ['Ac', 'Kc'], LOSE_BOARD, LOSE_TURN, LOSE_RIVER));
    const ctx = makeCtx(state, LOSE_HERO, LOSE_VILLAIN);
    // regret(call) = 30 ≤ epsilon(100) → correct
    const v = lenientPolicy.evaluate(state, { kind: 'Call' }, ctx);
    expect(v.correct).toBe(true);
  });

  it('reference contains evCall and regret', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const ctx = makeCtx(state, WIN_HERO, WIN_VILLAIN);
    const v = policy.evaluate(state, { kind: 'Call' }, ctx);
    const ref = v.reference as { evCall: number; regret: number };
    expect(ref.evCall).toBeCloseTo(70, 3);
    expect(ref.regret).toBeCloseTo(0, 3);
  });

  it('returns correct=false when no context provided', () => {
    const state = buildScenario(riverSpec(['Ah', 'Kh'], ['2c', '7d'], WIN_BOARD, WIN_TURN, WIN_RIVER));
    const v = policy.evaluate(state, { kind: 'Call' });
    expect(v.correct).toBe(false);
  });
});
