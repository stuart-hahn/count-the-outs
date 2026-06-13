import { describe, expect, it } from 'vitest';
import type { GameState, PlayerState, PlayerId, Amount } from '../src/gameState';
import type { TransitionEvent } from '../src/transitions';
import {
  settlePots,
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
  committed?: Record<PlayerId, Amount>;
  blinds?: Record<PlayerId, Amount>;
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
    id: 'stress',
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

function sumMap(m: Map<PlayerId, Amount>): number {
  return [...m.values()].reduce((a, b) => a + b, 0);
}

// Returns the given winner(s), filtering to only those in the eligible set.
function bh(winners: PlayerId[]): BestHandFn {
  const ws = new Set(winners);
  return (eligible) => eligible.filter(p => ws.has(p));
}

// ── 4-player ascending all-ins ────────────────────────────────────────────────

describe('4-player ascending all-ins: A=400 B=300 C=200 D=100', () => {
  // Level 100 → 400 [A,B,C,D]
  // Level 200 → 300 [A,B,C]    (D=100 below)
  // Level 300 → 200 [A,B]      (C=200 below)
  // Level 400 → 100 [A]        (B=300 below)
  // Total: 1000
  const commitments = cm({ A: 400, B: 300, C: 200, D: 100 });
  const folded = fd();

  it('creates exactly 4 pots', () => {
    const result = settlePots(commitments, folded);
    expect(result).toHaveLength(4);
  });

  it('pot amounts are correct', () => {
    const result = settlePots(commitments, folded);
    expect(result[0]!.amount).toBe(400);
    expect(result[1]!.amount).toBe(300);
    expect(result[2]!.amount).toBe(200);
    expect(result[3]!.amount).toBe(100);
  });

  it('eligible sets shrink correctly at each level', () => {
    const result = settlePots(commitments, folded);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']));
    expect(result[1]!.eligible).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(result[1]!.eligible).not.toContain('D');
    expect(result[2]!.eligible).toEqual(expect.arrayContaining(['A', 'B']));
    expect(result[2]!.eligible).not.toContain('C');
    expect(result[2]!.eligible).not.toContain('D');
    expect(result[3]!.eligible).toEqual(['A']);
  });

  it('total chips preserved', () => {
    const result = settlePots(commitments, folded);
    expect(result.reduce((s, p) => s + p.amount, 0)).toBe(1000);
  });

  it('D (shortest) wins main, others win respective side pots', () => {
    // D→main(400), C→side1(300), B→side2(200), A→side3(100)
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 400, B: 300, C: 200, D: 100 },
    });
    const bhFn: BestHandFn = (eligible) => {
      const priority = ['D', 'C', 'B', 'A'];
      const winner = priority.find(p => eligible.includes(p));
      return winner ? [winner] : eligible;
    };
    const result = payouts(state, bhFn);
    expect(result.get('D')).toBe(400);
    expect(result.get('C')).toBe(300);
    expect(result.get('B')).toBe(200);
    expect(result.get('A')).toBe(100);
    expect(sumMap(result)).toBe(1000);
  });

  it('B wins main + all side pots B is eligible for; A wins unchallenged top', () => {
    // bestHand always picks B if B is eligible; A wins side3 uncontested
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 400, B: 300, C: 200, D: 100 },
    });
    const bhFn: BestHandFn = (eligible) => eligible.includes('B') ? ['B'] : ['A'];
    const result = payouts(state, bhFn);
    expect(result.get('B')).toBe(900); // main(400)+side1(300)+side2(200)
    expect(result.get('A')).toBe(100); // side3 uncontested
    expect(result.get('C')).toBe(0);
    expect(result.get('D')).toBe(0);
    expect(sumMap(result)).toBe(1000);
  });

  it('A wins everything (best hand in all pots)', () => {
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 400, B: 300, C: 200, D: 100 },
    });
    const result = payouts(state, bh(['A']));
    expect(result.get('A')).toBe(1000);
    expect(result.get('B')).toBe(0);
    expect(result.get('C')).toBe(0);
    expect(result.get('D')).toBe(0);
  });

  it('all 4-way tie — chips returned to each according to their stake', () => {
    // 4-way tie in main (400 → 100 each); then A,B,C 3-way tie in side1 (300 → 100 each);
    // then A,B 2-way tie in side2 (200 → 100 each); A uncontested in side3 (100)
    // A=100+100+100+100=400, B=100+100+100=300, C=100+100=200, D=100
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 400, B: 300, C: 200, D: 100 },
    });
    const result = payouts(state, bh(['A', 'B', 'C', 'D']));
    expect(result.get('A')).toBe(400);
    expect(result.get('B')).toBe(300);
    expect(result.get('C')).toBe(200);
    expect(result.get('D')).toBe(100);
    expect(sumMap(result)).toBe(1000);
  });
});

// ── 5-player cascade ──────────────────────────────────────────────────────────

describe('5-player ascending all-ins: A=500 B=400 C=300 D=200 E=100', () => {
  // Level 100 → 500 [A,B,C,D,E]
  // Level 200 → 400 [A,B,C,D]
  // Level 300 → 300 [A,B,C]
  // Level 400 → 200 [A,B]
  // Level 500 → 100 [A]
  // Total: 1500
  const commitments = cm({ A: 500, B: 400, C: 300, D: 200, E: 100 });
  const folded = fd();

  it('creates exactly 5 pots', () => {
    expect(settlePots(commitments, folded)).toHaveLength(5);
  });

  it('pot amounts correct (100 each level×seats above threshold)', () => {
    const result = settlePots(commitments, folded);
    expect(result[0]!.amount).toBe(500);
    expect(result[1]!.amount).toBe(400);
    expect(result[2]!.amount).toBe(300);
    expect(result[3]!.amount).toBe(200);
    expect(result[4]!.amount).toBe(100);
    expect(result.reduce((s, p) => s + p.amount, 0)).toBe(1500);
  });

  it('shortest stack wins their pot only; total chips preserved', () => {
    // E wins main, D wins side1, C wins side2, B wins side3, A wins side4
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D', 'E'],
      buttonSeat: 'E',
      committed: { A: 500, B: 400, C: 300, D: 200, E: 100 },
    });
    const bhFn: BestHandFn = (eligible) => {
      const priority = ['E', 'D', 'C', 'B', 'A'];
      const winner = priority.find(p => eligible.includes(p));
      return winner ? [winner] : eligible;
    };
    const result = payouts(state, bhFn);
    expect(result.get('E')).toBe(500); // wins main only
    expect(result.get('D')).toBe(400);
    expect(result.get('C')).toBe(300);
    expect(result.get('B')).toBe(200);
    expect(result.get('A')).toBe(100);
    expect(sumMap(result)).toBe(1500);
  });
});

// ── 6-player stress ───────────────────────────────────────────────────────────

describe('6-player ascending all-ins: A=600 B=500 C=400 D=300 E=200 F=100', () => {
  // Level 100 → 600 [A,B,C,D,E,F]
  // Level 200 → 500 [A,B,C,D,E]
  // Level 300 → 400 [A,B,C,D]     (Σmin@300=300*4+200+100=1500; 1500-1100=400)
  // Level 400 → 300 [A,B,C]       (Σmin@400=400*3+300+200+100=1800; 1800-1500=300)
  // Level 500 → 200 [A,B]         (Σmin@500=500*2+400+300+200+100=2000; 2000-1800=200)
  // Level 600 → 100 [A]            (Σmin@600=2100; 2100-2000=100)
  // Total: 2100
  const commitments = cm({ A: 600, B: 500, C: 400, D: 300, E: 200, F: 100 });
  const folded = fd();

  it('creates exactly 6 pots with total 2100', () => {
    const result = settlePots(commitments, folded);
    expect(result).toHaveLength(6);
    expect(result.reduce((s, p) => s + p.amount, 0)).toBe(2100);
  });

  it('pot amounts and eligible sets correct', () => {
    const result = settlePots(commitments, folded);
    expect(result[0]!.amount).toBe(600);
    expect(result[0]!.eligible).toHaveLength(6);
    expect(result[1]!.amount).toBe(500);
    expect(result[1]!.eligible).toHaveLength(5);
    expect(result[1]!.eligible).not.toContain('F');
    expect(result[2]!.amount).toBe(400);
    expect(result[2]!.eligible).toHaveLength(4);
    expect(result[3]!.amount).toBe(300);
    expect(result[3]!.eligible).toHaveLength(3);
    expect(result[4]!.amount).toBe(200);
    expect(result[4]!.eligible).toHaveLength(2);
    expect(result[5]!.amount).toBe(100);
    expect(result[5]!.eligible).toEqual(['A']);
  });

  it('each player wins their respective highest-eligible pot', () => {
    // F wins main(600), E wins side1(500), D wins side2(400), C wins side3(300), B wins side4(200), A wins side5(100)
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D', 'E', 'F'],
      buttonSeat: 'F',
      committed: { A: 600, B: 500, C: 400, D: 300, E: 200, F: 100 },
    });
    const bhFn: BestHandFn = (eligible) => {
      // Shortest eligible stack wins each pot
      const order = ['F', 'E', 'D', 'C', 'B', 'A'];
      const winner = order.find(p => eligible.includes(p));
      return winner ? [winner] : eligible;
    };
    const result = payouts(state, bhFn);
    expect(result.get('F')).toBe(600);
    expect(result.get('E')).toBe(500);
    expect(result.get('D')).toBe(400);
    expect(result.get('C')).toBe(300);
    expect(result.get('B')).toBe(200);
    expect(result.get('A')).toBe(100);
    expect(sumMap(result)).toBe(2100);
  });
});

// ── folded-only level merges ──────────────────────────────────────────────────

describe('folded-only levels: chips merge into nearest eligible pot', () => {
  it('single fold above all active players: top layer merges into side pot', () => {
    // A=100, B=200 (folded), C=100
    // Level 100: Σ=300; eligible=[A,C]; amount=300
    // Level 200: Σ=400; eligible=[] (A<200, B folded, C<200); amount=100 → merges
    // Result: 1 pot {amount:400, eligible:[A,C]}
    const result = settlePots(cm({ A: 100, B: 200, C: 100 }), fd('B'));
    expect(result).toHaveLength(1);
    expect(result[0]!.amount).toBe(400);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'C']));
    expect(result[0]!.eligible).not.toContain('B');
  });

  it('fold in middle: excess of folded player merges, non-folded pot unaffected', () => {
    // A=200, B=300 (folded), C=100
    // Level 100: Σ=400; eligible=[A,C]; amount=400

    // Wait: actually B=300(folded), A=200, C=100
    // Levels: [100, 200, 300]
    // Level 100: Σmin(i,100)=100+100+100=300; eligible=[A,C]; amount=300
    // Level 200: Σmin(i,200)=200+200+100=500; eligible=[A] (B folded, C=100<200); amount=200
    // Level 300: Σmin(i,300)=200+300+100=600; eligible=[] (A=200<300, B folded, C<300); amount=100 → merges into {eligible:[A]}
    // Result: 2 pots: {300,[A,C]}, {300,[A]}
    const result = settlePots(cm({ A: 200, B: 300, C: 100 }), fd('B'));
    expect(result).toHaveLength(2);
    expect(result[0]!.amount).toBe(300);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'C']));
    expect(result[1]!.amount).toBe(300);
    expect(result[1]!.eligible).toEqual(['A']);
    expect(result[0]!.amount + result[1]!.amount).toBe(600);
  });

  it('multiple consecutive folded-only levels all cascade into one pot', () => {
    // A=100, B=300 (folded), C=400 (folded), D=100
    // Levels: [100, 300, 400]
    // Level 100: Σmin(i,100)=100+100+100+100=400; eligible=[A,D]; amount=400
    // Level 300: Σmin(i,300)=100+300+300+100=800; eligible=[] (A<300, B folded, C folded, D<300); amount=400 → merges
    // Level 400: Σmin(i,400)=100+300+400+100=900; eligible=[] (A<400, B folded, C folded, D<400); amount=100 → merges
    // Result: 1 pot {amount:900, eligible:[A,D]}
    const result = settlePots(cm({ A: 100, B: 300, C: 400, D: 100 }), fd('B', 'C'));
    expect(result).toHaveLength(1);
    expect(result[0]!.amount).toBe(900);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'D']));
    expect(result[0]!.eligible).not.toContain('B');
    expect(result[0]!.eligible).not.toContain('C');
  });

  it('4-player: fold at one mid-level, two survivors split merged pot', () => {
    // A=300, B=150 (folded), C=200, D=100
    // Levels: [100, 150, 200, 300]
    // Level 100: Σmin=100+100+100+100=400; eligible=[A,C,D]; amount=400
    // Level 150: Σmin=150+150+150+100=550; eligible=[A,C] (B folded, D<150); amount=150
    // Level 200: Σmin=200+150+200+100=650; eligible=[A,C] (B folded, D<200); amount=100
    //   wait: A=300≥200 and C=200≥200, but B is folded, D=100<200
    //   eligible=[A,C], amount=100 — not folded-only, so a normal pot
    // Level 300: Σmin=300+150+200+100=750; eligible=[A] (B folded, C=200<300, D<300); amount=100
    // Result: 4 pots: {400,[A,C,D]}, {150,[A,C]}, {100,[A,C]}, {100,[A]}
    const result = settlePots(cm({ A: 300, B: 150, C: 200, D: 100 }), fd('B'));
    expect(result).toHaveLength(4);
    expect(result[0]!.amount).toBe(400);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'C', 'D']));
    expect(result[1]!.amount).toBe(150);
    expect(result[1]!.eligible).toEqual(expect.arrayContaining(['A', 'C']));
    expect(result[2]!.amount).toBe(100);
    expect(result[2]!.eligible).toEqual(expect.arrayContaining(['A', 'C']));
    expect(result[3]!.amount).toBe(100);
    expect(result[3]!.eligible).toEqual(['A']);
    expect(result.reduce((s, p) => s + p.amount, 0)).toBe(750);
  });
});

// ── odd-chip distribution across pots ────────────────────────────────────────

describe('odd-chip: each pot distributes its remainder independently', () => {
  it('3-way tie in main, odd chip from folded short-stack goes to seatAfter(button)', () => {
    // A=100, B=100, C=100, D=1 (folded); seatOrder=[A,B,C,D], button=D → seatAfter(D)=A
    // Level 1: Σ=4; eligible=[A,B,C]; amount=4 → 4/3=1 rem 1 → A gets odd chip (A,B,C priority)
    // Level 100: Σ=301; eligible=[A,B,C]; amount=297 → 297/3=99 exactly
    // A=2+99=101, B=1+99=100, C=1+99=100
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 100, B: 100, C: 100, D: 1 },
      folded: ['D'],
    });
    const result = payouts(state, bh(['A', 'B', 'C']));
    expect(result.get('A')).toBe(101);
    expect(result.get('B')).toBe(100);
    expect(result.get('C')).toBe(100);
    expect(result.get('D')).toBe(0);
    expect(sumMap(result)).toBe(301);
  });

  it('same scenario, different button → odd chip goes to different player', () => {
    // button=A → seatAfter(A)=B → B gets odd chip from main pot
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'A',
      committed: { A: 100, B: 100, C: 100, D: 1 },
      folded: ['D'],
    });
    const result = payouts(state, bh(['A', 'B', 'C']));
    expect(result.get('B')).toBe(101);
    expect(result.get('A')).toBe(100);
    expect(result.get('C')).toBe(100);
    expect(sumMap(result)).toBe(301);
  });

  it('two pots with different eligible sets → each distributes odd chip independently', () => {
    // A=201, B=200, C=200; seatOrder=[A,B,C], button=C → seatAfter(C)=A
    // Level 200: Σmin=200+200+200=600; eligible=[A,B,C]; amount=600 → 200 each (even)
    // Level 201: Σmin=201+200+200=601; eligible=[A] (B=200<201, C<201); amount=1 → A uncontested
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 201, B: 200, C: 200 },
    });
    const result = payouts(state, bh(['A', 'B', 'C']));
    expect(result.get('A')).toBe(201); // 200 (main 3-way) + 1 (side uncontested)
    expect(result.get('B')).toBe(200);
    expect(result.get('C')).toBe(200);
    expect(sumMap(result)).toBe(601);
  });

  it('3-pot scenario: main has odd chip (rem=1) and side has no odd chip', () => {
    // A=203, B=101, C=102; seatOrder=[A,B,C], button=C → seatAfter(C)=A
    // Levels: [101, 102, 203]
    // Level 101: Σmin=101+101+101=303; eligible=[A,B,C]; amount=303 → 101 each (even)
    // Level 102: Σmin=102+101+102=305; eligible=[A,C] (B=101<102); amount=2 → 1 each (even)
    // Level 203: Σmin=203+101+102=406; eligible=[A] (B<203, C=102<203); amount=101 uncontested
    // A=101+1+101=203, B=101, C=101+1=102
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 203, B: 101, C: 102 },
    });
    const result = payouts(state, bh(['A', 'B', 'C']));
    expect(result.get('A')).toBe(203);
    expect(result.get('B')).toBe(101);
    expect(result.get('C')).toBe(102);
    expect(sumMap(result)).toBe(406);
  });
});

// ── duplicate commitment levels ───────────────────────────────────────────────

describe('duplicate commitment levels: two players share same all-in amount', () => {
  it('two equal short stacks create one pot for that level', () => {
    // A=200, B=100, C=100 (C and B both 100-all-in)
    // Levels: [100, 200]
    // Level 100: Σ=100+100+100=300; eligible=[A,B,C]; amount=300
    // Level 200: Σ=200+100+100=400; eligible=[A] (B=C=100<200); amount=100
    const result = settlePots(cm({ A: 200, B: 100, C: 100 }), fd());
    expect(result).toHaveLength(2);
    expect(result[0]!.amount).toBe(300);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(result[1]!.amount).toBe(100);
    expect(result[1]!.eligible).toEqual(['A']);
    expect(result[0]!.amount + result[1]!.amount).toBe(400);
  });

  it('two equal deepest stacks: both in same side pot, both eligible to win it', () => {
    // A=200, B=200, C=100, D=100 — two pairs at same level
    // Levels: [100, 200]
    // Level 100: Σ=100+100+100+100=400; eligible=[A,B,C,D]; amount=400
    // Level 200: Σ=200+200+100+100=600; eligible=[A,B] (C=D=100<200); amount=200
    const result = settlePots(cm({ A: 200, B: 200, C: 100, D: 100 }), fd());
    expect(result).toHaveLength(2);
    expect(result[0]!.amount).toBe(400);
    expect(result[0]!.eligible).toHaveLength(4);
    expect(result[1]!.amount).toBe(200);
    expect(result[1]!.eligible).toEqual(expect.arrayContaining(['A', 'B']));
    expect(result[1]!.eligible).not.toContain('C');
    expect(result[1]!.eligible).not.toContain('D');
  });

  it('C and D tie for main, C and D not eligible for side → A/B split side', () => {
    // A=200, B=200, C=100, D=100; C+D win main; A+B tie side
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 200, B: 200, C: 100, D: 100 },
    });
    const bhFn: BestHandFn = (eligible) =>
      eligible.includes('C') ? eligible.filter(p => p === 'C' || p === 'D') : ['A', 'B'];
    const result = payouts(state, bhFn);
    expect(result.get('C')).toBe(200); // half of main(400)
    expect(result.get('D')).toBe(200); // half of main(400)
    expect(result.get('A')).toBe(100); // half of side(200)
    expect(result.get('B')).toBe(100); // half of side(200)
    expect(sumMap(result)).toBe(600);
  });
});

// ── chip conservation invariant ───────────────────────────────────────────────

describe('chip conservation: total in = total out across multi-pot scenarios', () => {
  const cases: Array<{
    label: string;
    commitments: Record<PlayerId, Amount>;
    folded?: PlayerId[];
  }> = [
    { label: '5-way equal stacks', commitments: { A: 300, B: 300, C: 300, D: 300, E: 300 } },
    { label: '4-way cascade', commitments: { A: 400, B: 300, C: 200, D: 100 } },
    { label: 'odd amounts', commitments: { A: 173, B: 89, C: 211, D: 45 } },
    { label: 'three folded, one active', commitments: { A: 100, B: 200, C: 150, D: 300 }, folded: ['B', 'C', 'D'] },
    { label: '6-player cascade', commitments: { A: 600, B: 500, C: 400, D: 300, E: 200, F: 100 } },
    { label: 'folded-only merge', commitments: { A: 100, B: 300, C: 400, D: 100 }, folded: ['B', 'C'] },
    { label: 'asymmetric 5-player', commitments: { A: 500, B: 123, C: 456, D: 78, E: 321 } },
  ];

  for (const { label, commitments, folded = [] } of cases) {
    it(`total chips preserved: ${label}`, () => {
      const total = Object.values(commitments).reduce((a, b) => a + b, 0);
      const pots = settlePots(cm(commitments), fd(...folded));
      expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(total);
    });
  }
});

// ── complex multi-pot showdowns ───────────────────────────────────────────────

describe('complex multi-pot showdowns', () => {
  it('5-player: two all-ins, two folds mid-hand, survivor takes multiple pots', () => {
    // A=300 (folds), B=200 (all-in), C=400, D=100 (folds), E=400
    // Levels: [100, 200, 300, 400]
    // Level 100: Σmin=100+100+100+100+100=500; eligible=[B,C,E] (A,D folded); amount=500
    // Level 200: Σmin=200+200+200+100+200=900; eligible=[B,C,E] → wait B=200 ok; A folded; D=100<200 and folded; eligible={B,C,E}; amount=400
    //   Wait actually at level 200: eligible = {i: commitment_i>=200 && !folded}
    //   A=300 but FOLDED → not eligible
    //   B=200: 200>=200 and not folded → eligible
    //   C=400: eligible
    //   D=100<200 and folded → not eligible
    //   E=400: eligible
    //   eligible=[B,C,E]; amount=900-500=400
    // Level 300: Σmin=300+200+300+100+300=1200; eligible=[C,E] (A folded, B=200<300, D folded); amount=300
    // Level 400: Σmin=300+200+400+100+400=1400; eligible=[C,E] (B<400); amount=200
    // Total: 500+400+300+200=1400 = 300+200+400+100+400 ✓
    const result = settlePots(
      cm({ A: 300, B: 200, C: 400, D: 100, E: 400 }),
      fd('A', 'D')
    );
    expect(result).toHaveLength(4);
    expect(result[0]!.amount).toBe(500);
    expect(result[0]!.eligible).toEqual(expect.arrayContaining(['B', 'C', 'E']));
    expect(result[0]!.eligible).not.toContain('A');
    expect(result[0]!.eligible).not.toContain('D');
    expect(result[1]!.amount).toBe(400);
    expect(result[1]!.eligible).toEqual(expect.arrayContaining(['B', 'C', 'E']));
    expect(result[2]!.amount).toBe(300);
    expect(result[2]!.eligible).toEqual(expect.arrayContaining(['C', 'E']));
    expect(result[2]!.eligible).not.toContain('B');
    expect(result[3]!.amount).toBe(200);
    expect(result[3]!.eligible).toEqual(expect.arrayContaining(['C', 'E']));
    expect(result.reduce((s, p) => s + p.amount, 0)).toBe(1400);
  });

  it('B (short all-in) wins main; C and E split side pots (tie); B gets nothing from upper pots', () => {
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D', 'E'],
      buttonSeat: 'E',
      committed: { A: 300, B: 200, C: 400, D: 100, E: 400 },
      folded: ['A', 'D'],
    });
    // B wins main(500), B wins 2nd pot(400) [B still eligible]; C+E tie 3rd(300); C+E tie 4th(200)
    const bhFn: BestHandFn = (eligible) => eligible.includes('B') ? ['B'] : ['C', 'E'];
    const result = payouts(state, bhFn);
    expect(result.get('B')).toBe(900); // main(500)+2nd(400)
    expect(result.get('C')).toBe(250); // half of 3rd(300)+4th(200)=250
    expect(result.get('E')).toBe(250);
    expect(result.get('A')).toBe(0);
    expect(result.get('D')).toBe(0);
    expect(sumMap(result)).toBe(1400);
  });

  it('3-way showdown: main split three ways, side won outright, no remainder in main', () => {
    // A=300, B=300, C=100 (all-in)
    // Level 100: Σ=300; eligible=[A,B,C]; amount=300
    // Level 300: Σ=700; eligible=[A,B]; amount=400
    const state = makeState({
      seatOrder: ['A', 'B', 'C'],
      buttonSeat: 'C',
      committed: { A: 300, B: 300, C: 100 },
    });
    // A, B, C 3-way tie in main; A wins side
    const bhFn: BestHandFn = (eligible) =>
      eligible.includes('C') ? ['A', 'B', 'C'] : ['A'];
    const result = payouts(state, bhFn);
    expect(result.get('C')).toBe(100); // 300/3=100
    expect(result.get('A')).toBe(100 + 400); // 100 from main + 400 from side (won outright)
    expect(result.get('B')).toBe(100); // 100 from main
    expect(sumMap(result)).toBe(700);
  });

  it('4-player: C wins main + two pots; A takes unchallenged top', () => {
    // A=400, B=300, C=200, D=100; C eligible in main+side1; C wins both; A wins side2+3
    const state = makeState({
      seatOrder: ['A', 'B', 'C', 'D'],
      buttonSeat: 'D',
      committed: { A: 400, B: 300, C: 200, D: 100 },
    });
    // C wins every pot C is in; A wins rest
    const bhFn: BestHandFn = (eligible) =>
      eligible.includes('C') ? ['C'] : ['A'];
    const result = payouts(state, bhFn);
    // pots: main(400,[A,B,C,D])→C, side1(300,[A,B,C])→C, side2(200,[A,B])→A, side3(100,[A])→A
    expect(result.get('C')).toBe(700); // 400+300
    expect(result.get('A')).toBe(300); // 200+100
    expect(result.get('B')).toBe(0);
    expect(result.get('D')).toBe(0);
    expect(sumMap(result)).toBe(1000);
  });
});

// ── heads-up all-in regression ────────────────────────────────────────────────

describe('heads-up all-in regressions', () => {
  it('short stack wins main, deeper stack wins returned chips', () => {
    // A=300, B=100 (all-in); B wins main(200), A wins side(200)
    // Level 100: Σ=200; eligible=[A,B]; amount=200
    // Level 300: Σ=400; eligible=[A]; amount=200
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 300, B: 100 },
    });
    const result = payouts(state, bh(['B']));
    expect(result.get('B')).toBe(200); // wins main
    expect(result.get('A')).toBe(200); // wins unchallenged side (return of excess)
    expect(sumMap(result)).toBe(400);
  });

  it('bigger stack wins main; short stack gets nothing (lost the all-in)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 300, B: 100 },
    });
    // A wins main; B not eligible for side
    const result = payouts(state, bh(['A']));
    expect(result.get('A')).toBe(400); // wins main(200) + side(200) uncontested
    expect(result.get('B')).toBe(0);
  });

  it('exactly equal stacks, one player wins', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 500, B: 500 },
    });
    const result = payouts(state, bh(['B']));
    expect(result.get('B')).toBe(1000);
    expect(result.get('A')).toBe(0);
  });

  it('exactly equal stacks, split pot', () => {
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      committed: { A: 500, B: 500 },
    });
    const result = payouts(state, bh(['A', 'B']));
    expect(result.get('A')).toBe(500);
    expect(result.get('B')).toBe(500);
    expect(sumMap(result)).toBe(1000);
  });

  it('odd total heads-up: odd chip goes to seatAfter(button)', () => {
    // A=101, B=100; level 100: Σ=200 tied → 100 each; level 101: eligible=[A] → 1
    // seatOrder=[A,B], button=B → seatAfter(B)=A
    const state = makeState({
      seatOrder: ['A', 'B'],
      buttonSeat: 'B',
      committed: { A: 101, B: 100 },
    });
    const result = payouts(state, bh(['A', 'B']));
    expect(result.get('A')).toBe(101); // 100 + 1 uncontested
    expect(result.get('B')).toBe(100);
    expect(sumMap(result)).toBe(201);
  });
});
