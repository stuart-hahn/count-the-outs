import { describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../src/scenarioBuilder';
import type { Verdict } from '../src/policies';
import type { DrillRecord } from '../src/drillRecord';
import { DrillLog, accuracy, filterByCore, leaks, trend } from '../src/drillRecord';

// ── helpers ───────────────────────────────────────────────────────────────────

const MINIMAL_SPEC: ScenarioSpec = {
  seatOrder: ['p1', 'p2'],
  buttonSeat: 'p1',
  bigBlind: 100,
  stacks: new Map([['p1', 1000], ['p2', 1000]]),
  steps: [],
};

const CORRECT_VERDICT: Verdict = { correct: true, score: 1, reference: null, explanation: 'ok' };
const WRONG_VERDICT: Verdict = { correct: false, score: 0, reference: null, explanation: 'bad' };
const PARTIAL_VERDICT: Verdict = { correct: true, score: 0.6, reference: null, explanation: 'meh' };

function rec(
  score: number,
  core: DrillRecord['tags']['core'] = {},
  timestamp = 0,
): DrillRecord {
  const verdict: Verdict = { correct: score >= 0.5, score, reference: null, explanation: '' };
  return {
    scenarioSpec: MINIMAL_SPEC,
    userAction: { kind: 'Fold' },
    verdict,
    tags: { core, aux: {} },
    timestamp,
  };
}

// ── DrillLog ──────────────────────────────────────────────────────────────────

describe('DrillLog', () => {
  it('starts empty', () => {
    const log = new DrillLog();
    expect(log.all()).toHaveLength(0);
  });

  it('append adds records in order', () => {
    const log = new DrillLog();
    const r1 = rec(1, {}, 1);
    const r2 = rec(0, {}, 2);
    log.append(r1);
    log.append(r2);
    expect(log.all()).toHaveLength(2);
    expect(log.all()[0]).toBe(r1);
    expect(log.all()[1]).toBe(r2);
  });

  it('all() returns readonly view; external mutation does not corrupt log', () => {
    const log = new DrillLog();
    log.append(rec(1));
    const view = log.all() as DrillRecord[];
    view.push(rec(0));
    expect(log.all()).toHaveLength(1);
  });

  it('stores multiple records independently', () => {
    const log = new DrillLog();
    for (let i = 0; i < 5; i++) log.append(rec(i / 4));
    expect(log.all()).toHaveLength(5);
  });
});

// ── accuracy ──────────────────────────────────────────────────────────────────

describe('accuracy', () => {
  it('returns 0 for empty input', () => {
    expect(accuracy([])).toBe(0);
  });

  it('returns score for single record', () => {
    expect(accuracy([rec(0.8)])).toBeCloseTo(0.8);
  });

  it('averages scores', () => {
    expect(accuracy([rec(1), rec(0)])).toBeCloseTo(0.5);
  });

  it('handles all-correct', () => {
    expect(accuracy([rec(1), rec(1), rec(1)])).toBe(1);
  });

  it('handles partial scores', () => {
    const records = [rec(1), rec(0.6), rec(0.2)];
    expect(accuracy(records)).toBeCloseTo((1 + 0.6 + 0.2) / 3);
  });
});

// ── filterByCore ──────────────────────────────────────────────────────────────

describe('filterByCore', () => {
  it('empty filter returns all records', () => {
    const records = [rec(1, { position: 'BTN' }), rec(0, { position: 'BB' })];
    expect(filterByCore(records, {})).toHaveLength(2);
  });

  it('filters by position', () => {
    const records = [
      rec(1, { position: 'BTN' }),
      rec(0, { position: 'BB' }),
      rec(0.5, { position: 'BTN' }),
    ];
    const result = filterByCore(records, { position: 'BTN' });
    expect(result).toHaveLength(2);
    expect(result.every(r => r.tags.core.position === 'BTN')).toBe(true);
  });

  it('filters by street', () => {
    const records = [
      rec(1, { street: 'preflop' }),
      rec(0, { street: 'flop' }),
      rec(0.5, { street: 'preflop' }),
    ];
    expect(filterByCore(records, { street: 'preflop' })).toHaveLength(2);
  });

  it('filters by multiple core keys (AND semantics)', () => {
    const records = [
      rec(1, { position: 'BTN', street: 'preflop' }),
      rec(0, { position: 'BTN', street: 'flop' }),
      rec(0.5, { position: 'BB', street: 'preflop' }),
    ];
    const result = filterByCore(records, { position: 'BTN', street: 'preflop' });
    expect(result).toHaveLength(1);
    expect(result[0]!.verdict.score).toBe(1);
  });

  it('returns empty when no match', () => {
    const records = [rec(1, { position: 'BTN' })];
    expect(filterByCore(records, { position: 'SB' })).toHaveLength(0);
  });

  it('ignores records missing the filtered tag', () => {
    const records = [rec(1, {}), rec(0, { position: 'BTN' })];
    expect(filterByCore(records, { position: 'BTN' })).toHaveLength(1);
  });
});

// ── leaks ─────────────────────────────────────────────────────────────────────

describe('leaks', () => {
  it('returns empty map for empty input', () => {
    expect(leaks([], 'position').size).toBe(0);
  });

  it('groups by position and computes accuracy per group', () => {
    const records = [
      rec(1, { position: 'BTN' }),
      rec(0, { position: 'BTN' }),
      rec(1, { position: 'BB' }),
    ];
    const result = leaks(records, 'position');
    expect(result.get('BTN')).toBeCloseTo(0.5);
    expect(result.get('BB')).toBeCloseTo(1);
  });

  it('groups by street', () => {
    const records = [
      rec(1, { street: 'preflop' }),
      rec(0.5, { street: 'preflop' }),
      rec(0, { street: 'flop' }),
    ];
    const result = leaks(records, 'street');
    expect(result.get('preflop')).toBeCloseTo(0.75);
    expect(result.get('flop')).toBeCloseTo(0);
  });

  it('groups records with missing tag under "unknown"', () => {
    const records = [rec(1, {}), rec(0, {})];
    const result = leaks(records, 'position');
    expect(result.get('unknown')).toBeCloseTo(0.5);
  });

  it('groups by actionContext', () => {
    const records = [
      rec(1, { actionContext: 'open' }),
      rec(0, { actionContext: 'facing-raise' }),
      rec(0.5, { actionContext: 'open' }),
    ];
    const result = leaks(records, 'actionContext');
    expect(result.get('open')).toBeCloseTo(0.75);
    expect(result.get('facing-raise')).toBeCloseTo(0);
  });

  it('groups by stackDepth', () => {
    const records = [
      rec(1, { stackDepth: 'deep' }),
      rec(0, { stackDepth: 'short' }),
      rec(1, { stackDepth: 'deep' }),
    ];
    const result = leaks(records, 'stackDepth');
    expect(result.get('deep')).toBeCloseTo(1);
    expect(result.get('short')).toBeCloseTo(0);
  });

  it('groups by potType', () => {
    const records = [
      rec(1, { potType: 'single-raised' }),
      rec(0, { potType: 'multi-raised' }),
    ];
    const result = leaks(records, 'potType');
    expect(result.get('single-raised')).toBeCloseTo(1);
    expect(result.get('multi-raised')).toBeCloseTo(0);
  });
});

// ── trend ─────────────────────────────────────────────────────────────────────

describe('trend', () => {
  it('returns empty for empty input', () => {
    expect(trend([], 3)).toHaveLength(0);
  });

  it('returns empty for windowSize <= 0', () => {
    expect(trend([rec(1)], 0)).toHaveLength(0);
    expect(trend([rec(1)], -1)).toHaveLength(0);
  });

  it('returns empty when windowSize > records length', () => {
    expect(trend([rec(1), rec(0)], 5)).toHaveLength(0);
  });

  it('single window spanning all records', () => {
    const records = [rec(1, {}, 1), rec(0, {}, 2), rec(1, {}, 3)];
    expect(trend(records, 3)).toHaveLength(1);
    expect(trend(records, 3)[0]).toBeCloseTo(2 / 3);
  });

  it('sliding window produces correct series', () => {
    const records = [rec(1, {}, 1), rec(0, {}, 2), rec(1, {}, 3), rec(0, {}, 4)];
    const result = trend(records, 2);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.5);
  });

  it('sorts by timestamp before windowing', () => {
    const records = [rec(0, {}, 3), rec(1, {}, 1), rec(0, {}, 2)];
    const result = trend(records, 2);
    // sorted: [score=1 t=1, score=0 t=2, score=0 t=3]
    expect(result[0]).toBeCloseTo(0.5); // window [1,0]
    expect(result[1]).toBeCloseTo(0);   // window [0,0]
  });

  it('window of 1 returns each score individually', () => {
    const records = [rec(1, {}, 1), rec(0.4, {}, 2), rec(0.8, {}, 3)];
    const result = trend(records, 1);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBeCloseTo(0.4);
    expect(result[2]).toBeCloseTo(0.8);
  });

  it('improving trend shows rising values', () => {
    const records = [
      rec(0, {}, 1), rec(0, {}, 2), rec(0, {}, 3),
      rec(1, {}, 4), rec(1, {}, 5), rec(1, {}, 6),
    ];
    const result = trend(records, 3);
    expect(result[0]).toBeLessThan(result[result.length - 1]!);
  });
});

// ── integration: log + filter + accuracy ─────────────────────────────────────

describe('integration', () => {
  it('filter then accuracy identifies a leak', () => {
    const log = new DrillLog();
    log.append(rec(1, { position: 'BTN', street: 'preflop' }));
    log.append(rec(1, { position: 'BTN', street: 'preflop' }));
    log.append(rec(0, { position: 'BB', street: 'preflop' }));
    log.append(rec(0, { position: 'BB', street: 'preflop' }));

    const all = log.all();
    expect(accuracy(filterByCore(all, { position: 'BTN' }))).toBeCloseTo(1);
    expect(accuracy(filterByCore(all, { position: 'BB' }))).toBeCloseTo(0);
  });

  it('leaks identifies worst group', () => {
    const log = new DrillLog();
    log.append(rec(1, { street: 'preflop' }));
    log.append(rec(1, { street: 'preflop' }));
    log.append(rec(0, { street: 'river' }));

    const result = leaks(log.all(), 'street');
    const entries = [...result.entries()].sort((a, b) => a[1] - b[1]);
    expect(entries[0]![0]).toBe('river');
  });

  it('aux tags stored and accessible', () => {
    const log = new DrillLog();
    const r: DrillRecord = {
      scenarioSpec: MINIMAL_SPEC,
      userAction: { kind: 'Call' },
      verdict: CORRECT_VERDICT,
      tags: { core: {}, aux: { source: 'rangePolicy', spot: 'BTN_open' } },
      timestamp: Date.now(),
    };
    log.append(r);
    expect(log.all()[0]!.tags.aux['source']).toBe('rangePolicy');
    expect(log.all()[0]!.tags.aux['spot']).toBe('BTN_open');
  });

  it('verdict fields preserved in log', () => {
    const log = new DrillLog();
    log.append({ ...rec(0), verdict: PARTIAL_VERDICT });
    expect(log.all()[0]!.verdict.score).toBeCloseTo(0.6);
    expect(log.all()[0]!.verdict.correct).toBe(true);
  });

  void WRONG_VERDICT; // referenced for completeness check
});
