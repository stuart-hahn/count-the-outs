import { describe, expect, it } from 'vitest';
import { parseCard } from '@count-the-outs/engine';
import type { GameState } from '@count-the-outs/engine';
import { comboKey, keyToCombo, effectiveRange, parseRange } from '../src/range';
import { compute } from '../src/equity';

function makeState(board: string[], street: GameState['street']): GameState {
  return {
    id: 'test',
    variant: 'nlhe',
    street,
    seatOrder: ['p1', 'p2'],
    buttonSeat: 'p1',
    bigBlind: 100,
    currentBetLevel: 0,
    lastFullBetLevel: 0,
    lastFullRaiseIncrement: 100,
    players: [],
    board: board.map(parseCard),
    history: [],
  };
}

function river(board: string[]): GameState { return makeState(board, 'river'); }
function turn(board: string[]): GameState { return makeState(board, 'turn'); }

// ── comboKey ──────────────────────────────────────────────────────────────────

describe('comboKey', () => {
  it('canonical: argument order does not change the key', () => {
    const a = parseCard('As'), b = parseCard('Kh');
    expect(comboKey(a, b)).toBe(comboKey(b, a));
  });

  it('higher rank comes first', () => {
    expect(comboKey(parseCard('As'), parseCard('Kh'))).toBe('As_Kh');
  });

  it('same rank: lower suit-index first (c < d < h < s)', () => {
    expect(comboKey(parseCard('As'), parseCard('Ac'))).toBe('Ac_As');
    expect(comboKey(parseCard('Ac'), parseCard('As'))).toBe('Ac_As');
  });
});

// ── keyToCombo ────────────────────────────────────────────────────────────────

describe('keyToCombo', () => {
  it('round-trips comboKey', () => {
    const a = parseCard('Kd'), b = parseCard('Qh');
    const [ra, rb] = keyToCombo(comboKey(a, b));
    expect(ra).toEqual(parseCard('Kd'));
    expect(rb).toEqual(parseCard('Qh'));
  });
});

// ── effectiveRange ────────────────────────────────────────────────────────────

describe('effectiveRange', () => {
  it('no dead cards: returns full range', () => {
    const r = parseRange('AA');
    expect(effectiveRange(r, [])).toEqual(new Map(r));
  });

  it('dead card removes all combos containing it', () => {
    const r = parseRange('AA'); // 6 combos
    const er = effectiveRange(r, [parseCard('As')]);
    // Ac-As, Ad-As, Ah-As all removed → 3 remain
    expect(er.size).toBe(3);
  });

  it('unrelated dead card leaves range intact', () => {
    const r = parseRange('AA'); // AA combos contain no 2c
    expect(effectiveRange(r, [parseCard('2c')]).size).toBe(6);
  });
});

// ── parseRange ────────────────────────────────────────────────────────────────

describe('parseRange', () => {
  it('pocket pair AA → 6 combos', () => { expect(parseRange('AA').size).toBe(6); });
  it('suited AKs → 4 combos', () => { expect(parseRange('AKs').size).toBe(4); });
  it('offsuit AKo → 12 combos', () => { expect(parseRange('AKo').size).toBe(12); });
  it('both AK → 16 combos', () => { expect(parseRange('AK').size).toBe(16); });
  it('pair plus QQ+ → 18 combos (QQ KK AA)', () => { expect(parseRange('QQ+').size).toBe(18); });
  it('pair dash JJ-99 → 18 combos (99 TT JJ)', () => { expect(parseRange('JJ-99').size).toBe(18); });
  it('suited plus ATs+ → 16 combos (ATs AJs AQs AKs)', () => { expect(parseRange('ATs+').size).toBe(16); });
  it('suited dash KQs-KTs → 12 combos (KTs KJs KQs)', () => { expect(parseRange('KQs-KTs').size).toBe(12); });
  it('specific combo AhKs → 1 combo', () => { expect(parseRange('AhKs').size).toBe(1); });

  it('weight modifier AA:0.5 → 6 combos all weight 0.5', () => {
    const r = parseRange('AA:0.5');
    expect(r.size).toBe(6);
    for (const w of r.values()) expect(w).toBe(0.5);
  });

  it('comma-separated QQ+,AKs → 22 combos', () => {
    // QQ(6) + KK(6) + AA(6) + AKs(4) = 22
    expect(parseRange('QQ+,AKs').size).toBe(22);
  });
});

// ── compute: exact equity ─────────────────────────────────────────────────────

describe('compute (exact, river)', () => {
  it('hero wins: three aces vs three kings', () => {
    // Board: AcKd2h7s3c — hero AsAd has trips aces, villain KhKs has trips kings
    const state = river(['Ac', 'Kd', '2h', '7s', '3c']);
    const { equity, method } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('AsAd')],
        ['p2', parseRange('KhKs')],
      ]),
    });
    expect(method.type).toBe('Exact');
    expect(equity.get('p1')).toBe(1.0);
    expect(equity.get('p2')).toBe(0.0);
  });

  it('split: both players play the broadway board', () => {
    // Board AhKdQcJhTs — 2c3d and 4s5h both use the board as best 5
    const state = river(['Ah', 'Kd', 'Qc', 'Jh', 'Ts']);
    const { equity } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('2c3d')],
        ['p2', parseRange('4s5h')],
      ]),
    });
    expect(equity.get('p1')).toBe(0.5);
    expect(equity.get('p2')).toBe(0.5);
  });

  it('villain wins: better 5th kicker (6 > 4)', () => {
    // Board AhKdQcJh2s — hero 3c4d has ace-high K-Q-J-4, villain 5s6h has ace-high K-Q-J-6
    const state = river(['Ah', 'Kd', 'Qc', 'Jh', '2s']);
    const { equity } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('3c4d')],
        ['p2', parseRange('5s6h')],
      ]),
    });
    expect(equity.get('p1')).toBe(0.0);
    expect(equity.get('p2')).toBe(1.0);
  });

  it('equities sum to 1.0', () => {
    const state = river(['Ac', 'Kd', '2h', '7s', '3c']);
    const { equity } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('AsAd')],
        ['p2', parseRange('KhKs')],
      ]),
    });
    const total = [...equity.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it('hero combo vs multi-combo range: three jacks beats all AA combos', () => {
    // Board JcKd2h7s3c — hero JsJh has three jacks, villain has full AA range (6 combos)
    // All AA combos give villain one pair aces; three jacks wins every time
    const state = river(['Jc', 'Kd', '2h', '7s', '3c']);
    const { equity, method } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('JsJh')],
        ['p2', parseRange('AA')],
      ]),
    });
    expect(method.type).toBe('Exact');
    expect(equity.get('p1')).toBe(1.0);
    expect(equity.get('p2')).toBe(0.0);
  });
});

// ── compute: exact equity at turn ─────────────────────────────────────────────

describe('compute (exact, turn)', () => {
  it('hero full house wins all runouts vs draws', () => {
    // Board AcKdKh2s (turn) — hero AsAd already has aces-full-of-kings
    // Villain QdJd can at best make a straight; full house beats any straight/two-pair/trip
    const state = turn(['Ac', 'Kd', 'Kh', '2s']);
    const { equity, method } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('AsAd')],
        ['p2', parseRange('QdJd')],
      ]),
    });
    expect(method.type).toBe('Exact');
    expect(equity.get('p1')).toBe(1.0);
    expect(equity.get('p2')).toBe(0.0);
  });
});

// ── compute: Monte Carlo fallback ─────────────────────────────────────────────

describe('compute (Monte Carlo)', () => {
  it('uses MC when threshold is 0', () => {
    const state = river(['Ac', 'Kd', '2h', '7s', '3c']);
    const { method } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('AsAd')],
        ['p2', parseRange('KhKs')],
      ]),
      configuration: { exactThreshold: 0, monteCarloSamples: 500 },
    });
    expect(method.type).toBe('MonteCarlo');
  });

  it('MC equities are in [0,1] and sum to 1', () => {
    // Large symmetric ranges — force MC via low threshold
    const state = river(['2c', '3d', '4h', '5s', '9c']);
    const { equity } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('QQ+,AKs,AKo')],
        ['p2', parseRange('QQ+,AKs,AKo')],
      ]),
      configuration: { exactThreshold: 0, monteCarloSamples: 1000 },
    });
    const p1 = equity.get('p1')!;
    const p2 = equity.get('p2')!;
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThanOrEqual(1);
    expect(p2).toBeGreaterThanOrEqual(0);
    expect(p2).toBeLessThanOrEqual(1);
    expect(p1 + p2).toBeCloseTo(1.0, 2);
  });

  it('MC stderr is reported and non-negative', () => {
    const state = river(['2c', '3d', '4h', '5s', '9c']);
    const { method } = compute({
      state,
      observer: 'p1',
      assumptions: new Map([
        ['p1', parseRange('AA')],
        ['p2', parseRange('KK')],
      ]),
      configuration: { exactThreshold: 0, monteCarloSamples: 200 },
    });
    expect(method.type).toBe('MonteCarlo');
    if (method.type === 'MonteCarlo') {
      expect(method.stderr).toBeGreaterThanOrEqual(0);
      expect(method.samples).toBe(200);
    }
  });
});
