import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/gameState';
import type { BestHandFn } from '../src/pots';
import { attempt, apply, handTerminal } from '../src/kernel';
import { nextButton, startHand, endHand, type TableState } from '../src/table';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTable(opts: {
  seatOrder: string[];
  buttonSeat: string;
  stacks: Record<string, number>;
  handNumber?: number;
  bigBlind?: number;
}): TableState {
  return {
    seatOrder: opts.seatOrder,
    buttonSeat: opts.buttonSeat,
    stacks: new Map(Object.entries(opts.stacks)),
    handNumber: opts.handNumber ?? 0,
    bigBlind: opts.bigBlind ?? 20,
  };
}

const firstWins: BestHandFn = (eligible) => [eligible[0]!];

// Post SB + BB given table bigBlind.
function postBlindsFull(state: GameState): GameState {
  const bb = state.bigBlind;
  const sb = bb / 2;
  let s = state;
  // SB
  const r1 = attempt(s, { kind: 'PostBlind', amount: sb });
  if (!r1.ok) throw new Error('SB post failed: ' + r1.error);
  for (const ev of r1.events) s = apply(s, ev);
  // BB
  const r2 = attempt(s, { kind: 'PostBlind', amount: bb });
  if (!r2.ok) throw new Error('BB post failed: ' + r2.error);
  for (const ev of r2.events) s = apply(s, ev);
  return s;
}

// ── nextButton ────────────────────────────────────────────────────────────────

describe('nextButton', () => {
  it('rotates A→B in 2-seat game', () => {
    const stacks = new Map([['A', 1000], ['B', 1000]]);
    expect(nextButton(['A', 'B'], 'A', stacks)).toBe('B');
  });

  it('wraps B→A in 2-seat game', () => {
    const stacks = new Map([['A', 1000], ['B', 1000]]);
    expect(nextButton(['A', 'B'], 'B', stacks)).toBe('A');
  });

  it('rotates A→B→C→A in 3-seat game', () => {
    const stacks = new Map([['A', 100], ['B', 100], ['C', 100]]);
    expect(nextButton(['A', 'B', 'C'], 'A', stacks)).toBe('B');
    expect(nextButton(['A', 'B', 'C'], 'B', stacks)).toBe('C');
    expect(nextButton(['A', 'B', 'C'], 'C', stacks)).toBe('A');
  });

  it('skips zero-stack seat: A→C when B is bust', () => {
    const stacks = new Map([['A', 100], ['B', 0], ['C', 100]]);
    expect(nextButton(['A', 'B', 'C'], 'A', stacks)).toBe('C');
  });

  it('skips zero-stack seat: wraps B→A when C is bust', () => {
    const stacks = new Map([['A', 100], ['B', 100], ['C', 0]]);
    expect(nextButton(['A', 'B', 'C'], 'B', stacks)).toBe('A');
  });

  it('skips bust button seat: A (bust) → B', () => {
    const stacks = new Map([['A', 0], ['B', 500], ['C', 500]]);
    expect(nextButton(['A', 'B', 'C'], 'A', stacks)).toBe('B');
  });

  it('throws if no active player exists', () => {
    const stacks = new Map([['A', 0], ['B', 0]]);
    expect(() => nextButton(['A', 'B'], 'A', stacks)).toThrow();
  });
});

// ── startHand ─────────────────────────────────────────────────────────────────

describe('startHand', () => {
  it('creates GameState with correct shape', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 } });
    const state = startHand(table);
    expect(state.variant).toBe('nlhe');
    expect(state.street).toBe('preflop');
    expect(state.seatOrder).toEqual(['A', 'B']);
    expect(state.buttonSeat).toBe('A');
    expect(state.history).toHaveLength(0);
    expect(state.board).toHaveLength(0);
  });

  it('carries bigBlind into GameState', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 500, B: 500 }, bigBlind: 50 });
    const state = startHand(table);
    expect(state.bigBlind).toBe(50);
    expect(state.lastFullRaiseIncrement).toBe(50);
  });

  it('players start fresh: stack from table, committed=0, seen=-1, not folded', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 800, B: 1200 } });
    const state = startHand(table);
    const a = state.players.find(p => p.id === 'A')!;
    const b = state.players.find(p => p.id === 'B')!;
    expect(a.stack).toBe(800);
    expect(b.stack).toBe(1200);
    expect(a.committedThisStreet).toBe(0);
    expect(a.seen).toBe(-1);
    expect(a.folded).toBe(false);
    expect(a.holeCards).toBeNull();
  });

  it('currentBetLevel starts at 0 (blinds not yet posted)', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 } });
    const state = startHand(table);
    expect(state.currentBetLevel).toBe(0);
    expect(state.lastFullBetLevel).toBe(0);
  });

  it('uses handNumber as id', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 }, handNumber: 7 });
    expect(startHand(table).id).toBe('7');
  });

  it('seatOrder array is an independent copy', () => {
    const seatOrder = ['A', 'B'];
    const table = makeTable({ seatOrder, buttonSeat: 'A', stacks: { A: 1000, B: 1000 } });
    const state = startHand(table);
    seatOrder.push('C');
    expect(state.seatOrder).toHaveLength(2);
  });
});

// ── endHand ───────────────────────────────────────────────────────────────────

describe('endHand', () => {
  it('updates stacks: remaining chips + payouts (SB folds, BB wins pot)', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 } });
    let state = startHand(table);
    state = postBlindsFull(state); // A=SB(10), B=BB(20)
    // A folds
    const r = attempt(state, { kind: 'Fold' });
    expect(r.ok).toBe(true);
    if (r.ok) for (const ev of r.events) state = apply(state, ev);
    expect(handTerminal(state)).toBe(true);

    const newTable = endHand(table, state, firstWins);
    // A: stack after SB = 990, payout = 0 → 990
    // B: stack after BB = 980, payout = 30 (SB 10 + BB 20) → 1010
    expect(newTable.stacks.get('A')).toBe(990);
    expect(newTable.stacks.get('B')).toBe(1010);
    expect([...newTable.stacks.values()].reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it('advances button after hand', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 } });
    let state = startHand(table);
    state = postBlindsFull(state);
    const r = attempt(state, { kind: 'Fold' });
    if (r.ok) for (const ev of r.events) state = apply(state, ev);

    const newTable = endHand(table, state, firstWins);
    expect(newTable.buttonSeat).toBe('B');
  });

  it('increments handNumber', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 }, handNumber: 3 });
    let state = startHand(table);
    state = postBlindsFull(state);
    const r = attempt(state, { kind: 'Fold' });
    if (r.ok) for (const ev of r.events) state = apply(state, ev);

    expect(endHand(table, state, firstWins).handNumber).toBe(4);
  });

  it('preserves bigBlind', () => {
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 }, bigBlind: 40 });
    let state = startHand(table);
    // manually post blinds at 40
    const r1 = attempt(state, { kind: 'PostBlind', amount: 20 });
    if (r1.ok) for (const ev of r1.events) state = apply(state, ev);
    const r2 = attempt(state, { kind: 'PostBlind', amount: 40 });
    if (r2.ok) for (const ev of r2.events) state = apply(state, ev);
    const r3 = attempt(state, { kind: 'Fold' });
    if (r3.ok) for (const ev of r3.events) state = apply(state, ev);

    expect(endHand(table, state, firstWins).bigBlind).toBe(40);
  });

  it('eliminates bust player from seatOrder and stacks', () => {
    // A starts with 20 (= 1 BB), B starts with 1000
    // A posts SB(10), B posts BB(20), A calls for 10 more → A commits 20
    // Showdown: B wins both pots → A ends with 0 chips → eliminated
    const table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 20, B: 1000 }, bigBlind: 20 });
    let state = startHand(table);
    // A posts SB (10)
    const r1 = attempt(state, { kind: 'PostBlind', amount: 10 });
    expect(r1.ok).toBe(true);
    if (r1.ok) for (const ev of r1.events) state = apply(state, ev);
    // B posts BB (20)
    const r2 = attempt(state, { kind: 'PostBlind', amount: 20 });
    expect(r2.ok).toBe(true);
    if (r2.ok) for (const ev of r2.events) state = apply(state, ev);
    // A calls (10 more to match BB)
    const r3 = attempt(state, { kind: 'Call' });
    expect(r3.ok).toBe(true);
    if (r3.ok) for (const ev of r3.events) state = apply(state, ev);
    // B checks
    const r4 = attempt(state, { kind: 'Check' });
    expect(r4.ok).toBe(true);
    if (r4.ok) for (const ev of r4.events) state = apply(state, ev);

    // Board reveal: flop (3 cards)
    state = apply(state, { kind: 'BoardCardsRevealed', street: 'flop', cards: [] });
    // B checks
    const r5 = attempt(state, { kind: 'Check' });
    if (r5.ok) for (const ev of r5.events) state = apply(state, ev);
    // A checks
    const r6 = attempt(state, { kind: 'Check' });
    if (r6.ok) for (const ev of r6.events) state = apply(state, ev);

    // Turn
    state = apply(state, { kind: 'BoardCardsRevealed', street: 'turn', cards: [] });
    const r7 = attempt(state, { kind: 'Check' });
    if (r7.ok) for (const ev of r7.events) state = apply(state, ev);
    const r8 = attempt(state, { kind: 'Check' });
    if (r8.ok) for (const ev of r8.events) state = apply(state, ev);

    // River
    state = apply(state, { kind: 'BoardCardsRevealed', street: 'river', cards: [] });
    const r9 = attempt(state, { kind: 'Check' });
    if (r9.ok) for (const ev of r9.events) state = apply(state, ev);
    const r10 = attempt(state, { kind: 'Check' });
    if (r10.ok) for (const ev of r10.events) state = apply(state, ev);

    expect(handTerminal(state)).toBe(true);

    // B wins (firstWins = first eligible player = B? No, firstWins = eligible[0])
    // seatOrder = ['A', 'B']; both eligible
    // firstWins returns eligible[0] = 'A'... but we want B to win to eliminate A
    // Use a BestHandFn that always picks B
    const bWins: BestHandFn = () => ['B'];
    const newTable = endHand(table, state, bWins);

    expect(newTable.seatOrder).not.toContain('A');
    expect(newTable.stacks.has('A')).toBe(false);
    expect(newTable.stacks.get('B')).toBe(1020); // B's remaining (980) + 40 from pot
  });
});

// ── integration: heads-up NLHE loop ──────────────────────────────────────────

describe('heads-up NLHE loop', () => {
  it('checkpoint: two hands with button rotation', () => {
    let table = makeTable({
      seatOrder: ['A', 'B'],
      buttonSeat: 'A',
      stacks: { A: 1000, B: 1000 },
      handNumber: 0,
    });

    // ── Hand 1: A is button/SB, folds ──────────────────────────────────────
    let state = startHand(table);
    state = postBlindsFull(state); // A=SB(10), B=BB(20)

    const rFold = attempt(state, { kind: 'Fold' });
    expect(rFold.ok).toBe(true);
    if (rFold.ok) for (const ev of rFold.events) state = apply(state, ev);
    expect(handTerminal(state)).toBe(true);

    table = endHand(table, state, firstWins);
    expect(table.handNumber).toBe(1);
    expect(table.buttonSeat).toBe('B'); // button rotated
    expect(table.stacks.get('A')).toBe(990);
    expect(table.stacks.get('B')).toBe(1010);

    // ── Hand 2: B is button/SB, folds ──────────────────────────────────────
    state = startHand(table);
    expect(state.buttonSeat).toBe('B'); // button carried forward

    state = postBlindsFull(state); // B=SB(10), A=BB(20)

    const rFold2 = attempt(state, { kind: 'Fold' });
    expect(rFold2.ok).toBe(true);
    if (rFold2.ok) for (const ev of rFold2.events) state = apply(state, ev);
    expect(handTerminal(state)).toBe(true);

    table = endHand(table, state, firstWins);
    expect(table.handNumber).toBe(2);
    expect(table.buttonSeat).toBe('A'); // rotates back
    // B lost SB: 1010-10=1000, won by A: A had 990, committed 20, remaining 970 + 30 payout = 1000
    expect(table.stacks.get('A')).toBe(1000);
    expect(table.stacks.get('B')).toBe(1000);
  });

  it('startHand after endHand uses updated stacks and buttonSeat', () => {
    let table = makeTable({ seatOrder: ['A', 'B'], buttonSeat: 'A', stacks: { A: 1000, B: 1000 } });

    let state = startHand(table);
    state = postBlindsFull(state);
    const r = attempt(state, { kind: 'Fold' });
    if (r.ok) for (const ev of r.events) state = apply(state, ev);
    table = endHand(table, state, firstWins);

    const state2 = startHand(table);
    expect(state2.buttonSeat).toBe('B');
    const b = state2.players.find(p => p.id === 'B')!;
    expect(b.stack).toBe(1010); // carries updated stack
  });
});
