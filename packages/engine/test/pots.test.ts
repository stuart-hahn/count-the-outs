import { describe, expect, it } from 'vitest';
import type { GameState, PlayerState, PlayerId, Amount } from '../src/gameState';
import type { TransitionEvent } from '../src/transitions';
import {
  settlePots,
  totalCommitments,
  pots,
  payouts,
  type BestHandFn,
} from '../src/pots';

// ── helpers ───────────────────────────────────────────────────────────────────

function cm(entries: Record<PlayerId, Amount>): Map<PlayerId, Amount> {
  return new Map(Object.entries(entries));
}

function fd(...ids: PlayerId[]): Set<PlayerId> {
  return new Set(ids);
}

function makeState(opts: {
  seatOrder: PlayerId[];
  buttonSeat: PlayerId;
  committed?: Record<PlayerId, Amount>;  // via ChipsCommitted events
  blinds?: Record<PlayerId, Amount>;     // via BlindPosted events
  folded?: PlayerId[];
}): GameState {
  const history: TransitionEvent[] = [];
  for (const [pid, amt] of Object.entries(opts.blinds ?? {})) {
    history.push({ kind: 'BlindPosted', player: pid, amount: amt });
  }
  for (const [pid, amt] of Object.entries(opts.committed ?? {})) {
    history.push({ kind: 'ChipsCommitted', player: pid, amount: amt });
  }
  return {
    id: 'test',
    variant: 'nlhe',
    street: 'river',
    seatOrder: opts.seatOrder,
    buttonSeat: opts.buttonSeat,
    bigBlind: 20,
    currentBetLevel: 0,
    lastFullBetLevel: 0,
    lastFullRaiseIncrement: 20,
    players: opts.seatOrder.map((id, i): PlayerState => ({
      id,
      seat: i,
      stack: 0,
      committedThisStreet: 0,
      folded: (opts.folded ?? []).includes(id),
      holeCards: null,
      seen: 0,
    })),
    board: [],
    history,
  };
}

// Deterministic bestHand mock: returns whichever playerIds are in `winners`.
function bestHandReturns(winners: PlayerId[]): BestHandFn {
  return (eligible) => eligible.filter(p => winners.includes(p));
}

// ── settlePots ────────────────────────────────────────────────────────────────

describe('settlePots', () => {
  it('empty commitments → empty pots', () => {
    expect(settlePots(new Map(), new Set())).toEqual([]);
  });

  it('single player, not folded → one pot with full amount', () => {
    const result = settlePots(cm({ A: 100 }), fd());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: 100, eligible: ['A'] });
  });

  it('two players equal commitment, none folded → one pot, both eligible', () => {
    const result = settlePots(cm({ A: 100, B: 100 }), fd());
    expect(result).toHaveLength(1);
    expect(result[0]!.amount).toBe(200);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'B']));
  });

  it('two players unequal: short all-in creates main + side', () => {
    // A=200, B=100 (all-in): level 100 → main(200, {A,B}); level 200 → side(100, {A})
    const result = settlePots(cm({ A: 200, B: 100 }), fd());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ amount: 200, eligible: expect.arrayContaining(['A', 'B']) });
    expect(result[1]).toMatchObject({ amount: 100, eligible: ['A'] });
  });

  it('one player folded: their chips stay, only non-folded eligible', () => {
    // A=100, B=100 (folded) → 1 pot, eligible=[A]
    const result = settlePots(cm({ A: 100, B: 100 }), fd('B'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: 200, eligible: ['A'] });
  });

  it('3-way: A=300, B=100 (all-in), C=200 — no folds → main+two sides', () => {
    const result = settlePots(cm({ A: 300, B: 100, C: 200 }), fd());
    expect(result).toHaveLength(3);
    // main: level 100 → 3×100 = 300, all eligible
    expect(result[0]).toMatchObject({ amount: 300, eligible: expect.arrayContaining(['A', 'B', 'C']) });
    // side1: level 200 → (200+100+200)-(300) = 200, A+C eligible (B below 200)
    expect(result[1]).toMatchObject({ amount: 200, eligible: expect.arrayContaining(['A', 'C']) });
    expect(result[1]!.eligible).not.toContain('B');
    // side2: level 300 → (300+100+200)-(500) = 100, only A eligible
    expect(result[2]).toMatchObject({ amount: 100, eligible: ['A'] });
    // total chips preserved
    const total = result.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(600); // 300+100+200
  });

  it('folded player at highest level: chips roll into adjacent eligible pot', () => {
    // A=250 (folded), B=100, C=200 — levels: 100,200,250
    // level 100 → 300, eligible=[B,C]
    // level 200 → (200+100+200)-(300)=200, eligible=[C] (A folded; B<200)
    // level 250 → (250+100+200)-(500)=50, eligible=[] → merges into previous
    const result = settlePots(cm({ A: 250, B: 100, C: 200 }), fd('A'));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ amount: 300, eligible: expect.arrayContaining(['B', 'C']) });
    expect(result[0]!.eligible).not.toContain('A');
    // C gets A's overage merged in
    expect(result[1]).toMatchObject({ amount: 250, eligible: ['C'] });
    // total: 250+100+200=550 = 300+250 ✓
    const total = result.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(550);
  });

  it('3-way fold leaves one player: all chips in one pot, only survivor eligible', () => {
    // A=200 (folded), B=150 (folded), C=100 (winner)
    const result = settlePots(cm({ A: 200, B: 150, C: 100 }), fd('A', 'B'));
    // level 100: eligible=[C]; level 150: eligible=[]; level 200: eligible=[]
    // → 1 pot, C eligible, amount=200+150+100=450
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: 450, eligible: ['C'] });
  });

  it('zero-commitment entries are ignored (no empty pots)', () => {
    const result = settlePots(cm({ A: 100, B: 0 }), fd());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: 100, eligible: ['A'] });
  });

  it('pot ids are sequential starting from 0', () => {
    const result = settlePots(cm({ A: 300, B: 100, C: 200 }), fd());
    expect(result.map(p => p.id)).toEqual([0, 1, 2]);
  });
});

// ── totalCommitments ──────────────────────────────────────────────────────────

describe('totalCommitments', () => {
  it('sums ChipsCommitted events per player', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 300, B: 200 },
    });
    const map = totalCommitments(state);
    expect(map.get('A')).toBe(300);
    expect(map.get('B')).toBe(200);
  });

  it('sums BlindPosted events per player', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      blinds: { A: 10, B: 20 },
    });
    const map = totalCommitments(state);
    expect(map.get('A')).toBe(10);
    expect(map.get('B')).toBe(20);
  });

  it('adds BlindPosted + ChipsCommitted for same player', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      blinds: { A: 10, B: 20 },
      committed: { A: 90, B: 80 }, // A total=100, B total=100
    });
    const map = totalCommitments(state);
    expect(map.get('A')).toBe(100);
    expect(map.get('B')).toBe(100);
  });

  it('returns empty map for no history', () => {
    const state = makeState({ seatOrder: ['A', 'B'], buttonSeat: 'A' });
    expect(totalCommitments(state).size).toBe(0);
  });
});

// ── pots (derived query) ──────────────────────────────────────────────────────

describe('pots', () => {
  it('derives from history + folded players', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 200, B: 100 },
      folded: [],
    });
    const result = pots(state);
    expect(result).toHaveLength(2);
    expect(result[0]!.amount).toBe(200);
    expect(result[1]!.amount).toBe(100);
  });

  it('folded player status from GameState.players', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 200, B: 200 },
      folded: ['B'],
    });
    const result = pots(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: 400, eligible: ['A'] });
  });
});

// ── payouts ───────────────────────────────────────────────────────────────────

describe('payouts', () => {
  it('single eligible player wins entire pot (no bestHand call)', () => {
    // A folded, B wins everything
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 200, B: 200 },
      folded: ['A'],
    });
    const called: PlayerId[][] = [];
    const bh: BestHandFn = (ids) => { called.push(ids); return ids; };
    const result = payouts(state, bh);
    expect(result.get('B')).toBe(400);
    expect(result.get('A')).toBe(0);
    expect(called).toHaveLength(0); // bestHand never called (B sole eligible)
  });

  it('two-player, one winner', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 300, B: 300 },
    });
    const result = payouts(state, bestHandReturns(['A']));
    expect(result.get('A')).toBe(600);
    expect(result.get('B')).toBe(0);
  });

  it('two-player tie, even pot → equal split', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 100, B: 100 },
    });
    const result = payouts(state, bestHandReturns(['A', 'B']));
    expect(result.get('A')).toBe(100);
    expect(result.get('B')).toBe(100);
  });

  it('odd chip goes to player earliest from seatAfter(button) — case 1', () => {
    // seatOrder=[A,B,C], buttonSeat=C → seatAfter(C)=A → priority: A,B,C
    // C folds but contributes 1 chip → pot0: 3 chips, eligible=[A,B]; pot1: 198 chips, eligible=[A,B]
    // A,B tied → pot0: A gets 2, B gets 1; pot1: 99 each
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 100, B: 100, C: 1 },
      folded: ['C'],
    });
    const result = payouts(state, bestHandReturns(['A', 'B']));
    expect(result.get('A')).toBe(101); // 2 + 99
    expect(result.get('B')).toBe(100); // 1 + 99
    expect(result.get('C')).toBe(0);
    expect((result.get('A')! + result.get('B')! + result.get('C')!)).toBe(201);
  });

  it('odd chip goes to player earliest from seatAfter(button) — case 2 (different button)', () => {
    // seatOrder=[A,B,C], buttonSeat=A → seatAfter(A)=B → priority: B,C,A
    // Same pot structure: B gets odd chip from pot0
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'A',
      committed: { A: 100, B: 100, C: 1 },
      folded: ['C'],
    });
    const result = payouts(state, bestHandReturns(['A', 'B']));
    expect(result.get('B')).toBe(101); // 2 + 99
    expect(result.get('A')).toBe(100); // 1 + 99
    expect(result.get('C')).toBe(0);
  });

  it('multi-pot: short all-in B wins main, A wins side pot', () => {
    // A=300, B=100 (all-in), C=200
    // pots: main(300,[A,B,C]), side1(200,[A,C]), side2(100,[A])
    // bestHand for [A,B,C] → [B]; for [A,C] → [A]; [A] uncontested
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 300, B: 100, C: 200 },
    });
    const bh: BestHandFn = (eligible) => {
      if (eligible.includes('B')) return ['B']; // B best hand in main
      return ['A'];                              // A wins any pot without B
    };
    const result = payouts(state, bh);
    expect(result.get('B')).toBe(300); // wins main pot only
    expect(result.get('A')).toBe(300); // wins side1(200) + side2(100)
    expect(result.get('C')).toBe(0);
    expect([...result.values()].reduce((a, b) => a + b, 0)).toBe(600);
  });

  it('multi-pot: C wins main + side1 (eligible for both), A wins top side', () => {
    // A=300, B=100 (all-in), C=200; C has best hand — wins every pot C is eligible for
    // pots: main(300,[A,B,C]), side1(200,[A,C]), side2(100,[A])
    // C eligible in main + side1 → wins both; A wins side2 uncontested
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 300, B: 100, C: 200 },
    });
    const bh: BestHandFn = (eligible) => {
      if (eligible.includes('C')) return ['C'];
      return ['A'];
    };
    const result = payouts(state, bh);
    expect(result.get('C')).toBe(500); // main(300) + side1(200)
    expect(result.get('A')).toBe(100); // side2(100) uncontested
    expect(result.get('B')).toBe(0);
    expect([...result.values()].reduce((a, b) => a + b, 0)).toBe(600);
  });

  it('per-pot remainder is independent: each pot distributes its own odd chip', () => {
    // A=101, B=101, C=101: 1 pot of 303, 3-way tie → 101 each (even)
    // Use a scenario with 2 different pots with different odd-chip outcomes
    // A=201, B=200, C=200: levels 200,201
    // level 200: curSum=600, amount=600, eligible=[A,B,C]
    // level 201: curSum=601, amount=1, eligible=[A]
    // All tied in main → 600/3=200 each (even), A gets +1 from level201 pot (uncontested)
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 201, B: 200, C: 200 },
    });
    const result = payouts(state, bestHandReturns(['A', 'B', 'C']));
    expect(result.get('A')).toBe(201); // 200 + 1 (uncontested)
    expect(result.get('B')).toBe(200);
    expect(result.get('C')).toBe(200);
    expect([...result.values()].reduce((a, b) => a + b, 0)).toBe(601);
  });

  it('all players initialized to 0 in result even if no pot eligible', () => {
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'A',
      committed: { A: 100 },
    });
    const result = payouts(state, bestHandReturns(['A']));
    expect(result.has('A')).toBe(true);
    expect(result.has('B')).toBe(true);
    expect(result.has('C')).toBe(true);
  });
});
