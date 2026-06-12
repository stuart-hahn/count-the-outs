import { describe, expect, it } from 'vitest';
import type { GameState, PlayerState, PlayerId, Amount, Street } from '../src/gameState';
import type { TransitionEvent } from '../src/transitions';
import {
  requiresAction,
  needsToAct,
  bettingRoundComplete,
  handTerminal,
  currentActor,
  legalActions,
  attempt,
  apply,
  deriveNext,
} from '../src/kernel';

// ── helpers ───────────────────────────────────────────────────────────────────

interface PlayerSpec {
  id: PlayerId;
  stack: Amount;
  committed: Amount;
  seen: Amount;
  folded?: boolean;
}

function makeState(opts: {
  street?: Street;
  seatOrder: PlayerId[];
  buttonSeat: PlayerId;
  bigBlind?: Amount;
  currentBetLevel: Amount;
  lastFullBetLevel: Amount;
  lastFullRaiseIncrement: Amount;
  players: PlayerSpec[];
  history?: TransitionEvent[];
}): GameState {
  return {
    id: 'test',
    variant: 'nlhe',
    street: opts.street ?? 'preflop',
    seatOrder: opts.seatOrder,
    buttonSeat: opts.buttonSeat,
    bigBlind: opts.bigBlind ?? 20,
    currentBetLevel: opts.currentBetLevel,
    lastFullBetLevel: opts.lastFullBetLevel,
    lastFullRaiseIncrement: opts.lastFullRaiseIncrement,
    players: opts.players.map((s, i): PlayerState => ({
      id: s.id,
      seat: i,
      stack: s.stack,
      committedThisStreet: s.committed,
      folded: s.folded ?? false,
      holeCards: null,
      seen: s.seen,
    })),
    board: [],
    history: opts.history ?? [],
  };
}

// Heads-up after blinds: A=Button/SB, B=BB
function headsUpAfterBlinds(opts: { aStack?: Amount; bStack?: Amount } = {}): GameState {
  const aStack = (opts.aStack ?? 100) - 10;
  const bStack = (opts.bStack ?? 100) - 20;
  return makeState({
    seatOrder: ['A', 'B'],
    buttonSeat: 'A',
    bigBlind: 20,
    currentBetLevel: 20,
    lastFullBetLevel: 20,
    lastFullRaiseIncrement: 20,
    players: [
      { id: 'A', stack: aStack, committed: 10, seen: 0 },
      { id: 'B', stack: bStack, committed: 20, seen: 0 },
    ],
    history: [
      { kind: 'BlindPosted', player: 'A', amount: 10 },
      { kind: 'BlindPosted', player: 'B', amount: 20 },
    ],
  });
}

// ── requiresAction ────────────────────────────────────────────────────────────

describe('requiresAction', () => {
  it('true when active with chips', () => {
    const p: PlayerState = { id: 'A', seat: 0, stack: 100, committedThisStreet: 0, folded: false, holeCards: null, seen: 0 };
    expect(requiresAction(p)).toBe(true);
  });

  it('false when folded', () => {
    const p: PlayerState = { id: 'A', seat: 0, stack: 100, committedThisStreet: 0, folded: true, holeCards: null, seen: 0 };
    expect(requiresAction(p)).toBe(false);
  });

  it('false when stack==0 (all-in)', () => {
    const p: PlayerState = { id: 'A', seat: 0, stack: 0, committedThisStreet: 50, folded: false, holeCards: null, seen: 50 };
    expect(requiresAction(p)).toBe(false);
  });
});

// ── needsToAct ────────────────────────────────────────────────────────────────

describe('needsToAct — chip deficit', () => {
  it('true when committed < currentBetLevel', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 900, committed: 0, seen: 0 },
        { id: 'B', stack: 900, committed: 100, seen: 100 },
      ],
    });
    expect(needsToAct(state, state.players[0]!)).toBe(true);
  });

  it('false when committed == currentBetLevel and seen == lastFullBetLevel', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 900, committed: 100, seen: 100 },
        { id: 'B', stack: 900, committed: 100, seen: 100 },
      ],
    });
    expect(needsToAct(state, state.players[0]!)).toBe(false);
    expect(needsToAct(state, state.players[1]!)).toBe(false);
  });
});

// invariants.md §4 Rejected #2 — BB option requires seen field
describe('needsToAct — BB option (invariant §4.2)', () => {
  it('BB needs to act after SB calls: chip deficit gone but reopened=true via seen', () => {
    // Heads-up, SB calls. committed={A:20,B:20}=currentBetLevel=20, but seen[B]=0 != lastFull=20
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 20, lastFullBetLevel: 20, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 20, seen: 20 }, // SB called
        { id: 'B', stack: 80, committed: 20, seen: 0 },  // BB hasn't acted
      ],
    });
    const [a, b] = state.players;
    expect(needsToAct(state, a!)).toBe(false); // SB acted, seen=lastFull
    expect(needsToAct(state, b!)).toBe(true);  // BB has decision deficit (seen=0 < lastFull=20)
  });

  it('BB does NOT need to act after checking (seen updated)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 20, lastFullBetLevel: 20, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 20, seen: 20 },
        { id: 'B', stack: 80, committed: 20, seen: 20 }, // BB checked, seen=20
      ],
    });
    expect(needsToAct(state, state.players[1]!)).toBe(false);
  });
});

// invariants.md §4 Rejected #3 — short all-in must not deadlock
describe('needsToAct — short all-in no deadlock (invariant §4.3)', () => {
  it('all-in player (stack==0) never needsToAct regardless of chip deficit', () => {
    // 3-way: A bet 100, B called all-in for 30, C called 100
    const state = makeState({
      seatOrder: ['A', 'B', 'C'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 900, committed: 100, seen: 100 },
        { id: 'B', stack: 0,   committed: 30,  seen: 100 }, // all-in, short
        { id: 'C', stack: 900, committed: 100, seen: 100 },
      ],
    });
    const [a, b, c] = state.players;
    expect(needsToAct(state, b!)).toBe(false); // stack==0 → requiresAction=false
    expect(needsToAct(state, a!)).toBe(false);
    expect(needsToAct(state, c!)).toBe(false);
    expect(bettingRoundComplete(state)).toBe(true);
  });
});

// ── bettingRoundComplete ──────────────────────────────────────────────────────

describe('bettingRoundComplete', () => {
  it('false while someone still has chip deficit', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 0,  seen: 0 },
      ],
    });
    expect(bettingRoundComplete(state)).toBe(false);
  });

  it('true when all players satisfied (both committed=currentBet, seen=lastFullBet)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 50, seen: 50 },
      ],
    });
    expect(bettingRoundComplete(state)).toBe(true);
  });

  it('true when one player folded', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 0,  seen: 0, folded: true },
      ],
    });
    expect(bettingRoundComplete(state)).toBe(true);
  });

  it('true when all active players are all-in', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 0, committed: 100, seen: 100 },
        { id: 'B', stack: 0, committed: 100, seen: 100 },
      ],
    });
    expect(bettingRoundComplete(state)).toBe(true);
  });
});

// ── handTerminal ──────────────────────────────────────────────────────────────

describe('handTerminal', () => {
  it('true when only 1 eligible player (fold)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 0,   committed: 0, seen: 0, folded: true },
      ],
    });
    expect(handTerminal(state)).toBe(true);
  });

  it('true on river + bettingRoundComplete', () => {
    const state = makeState({
      street: 'river',
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 50, seen: 50 },
      ],
    });
    expect(handTerminal(state)).toBe(true);
  });

  it('false on flop even when bettingRoundComplete', () => {
    const state = makeState({
      street: 'flop',
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 50, seen: 50 },
      ],
    });
    expect(handTerminal(state)).toBe(false);
  });

  it('false on river when betting not complete', () => {
    const state = makeState({
      street: 'river',
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 0,  seen: 0 },
      ],
    });
    expect(handTerminal(state)).toBe(false);
  });
});

// ── currentActor ──────────────────────────────────────────────────────────────

describe('currentActor — heads-up preflop ordering', () => {
  it('preflop first actor is Button (SB) — no actions yet', () => {
    const state = headsUpAfterBlinds();
    // history has BlindPosted only, no ActionAccepted
    expect(currentActor(state)).toBe('A'); // A=Button acts first preflop
  });

  it('after A acts, next actor is B', () => {
    const state = headsUpAfterBlinds();
    const afterA: GameState = {
      ...state,
      players: state.players.map(p =>
        p.id === 'A' ? { ...p, committedThisStreet: 20, stack: 80, seen: 20 } : p
      ),
      history: [
        ...state.history,
        { kind: 'ActionAccepted', player: 'A', command: { kind: 'Call' } },
      ],
    };
    expect(currentActor(afterA)).toBe('B');
  });

  it('after A calls and B checks, currentActor is null (bettingRoundComplete)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 20, lastFullBetLevel: 20, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 20, seen: 20 },
        { id: 'B', stack: 80, committed: 20, seen: 20 },
      ],
      history: [
        { kind: 'BlindPosted', player: 'A', amount: 10 },
        { kind: 'BlindPosted', player: 'B', amount: 20 },
        { kind: 'ActionAccepted', player: 'A', command: { kind: 'Call' } },
        { kind: 'ActionAccepted', player: 'B', command: { kind: 'Check' } },
      ],
    });
    expect(currentActor(state)).toBe(null);
    expect(bettingRoundComplete(state)).toBe(true);
  });
});

describe('currentActor — postflop ordering', () => {
  it('postflop first actor is BB (seatAfter Button)', () => {
    const state = makeState({
      street: 'flop',
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 0, seen: -1 },
        { id: 'B', stack: 80, committed: 0, seen: -1 },
      ],
    });
    expect(currentActor(state)).toBe('B'); // B=BB acts first postflop
  });

  it('3-way postflop: first actor is first eligible seat after button', () => {
    // seatOrder=[A,B,C], button=A. firstToAct=B
    const state = makeState({
      street: 'flop',
      seatOrder: ['A', 'B', 'C'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 0, seen: -1 },
        { id: 'B', stack: 80, committed: 0, seen: -1 },
        { id: 'C', stack: 80, committed: 0, seen: -1 },
      ],
    });
    expect(currentActor(state)).toBe('B');
  });

  it('3-way postflop: skips folded players', () => {
    const state = makeState({
      street: 'flop',
      seatOrder: ['A', 'B', 'C'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 0, seen: -1 },
        { id: 'B', stack: 0,  committed: 0, seen: -1, folded: true },
        { id: 'C', stack: 80, committed: 0, seen: -1 },
      ],
    });
    expect(currentActor(state)).toBe('C'); // B folded, skip to C
  });
});

// ── legalActions ──────────────────────────────────────────────────────────────

describe('legalActions', () => {
  it('canCheck when toCall==0', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: -1 },
        { id: 'B', stack: 100, committed: 0, seen: -1 },
      ],
    });
    const la = legalActions(state, 'A');
    expect(la.canCheck).toBe(true);
    expect(la.canCall).toBe(false);
  });

  it('cannot check when facing a bet', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 950, committed: 50, seen: 50 },
      ],
    });
    const la = legalActions(state, 'A');
    expect(la.canCheck).toBe(false);
    expect(la.canCall).toBe(true);
    expect(la.callAmount).toBe(50);
  });

  it('call amount capped at stack (partial call / all-in call)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 30, committed: 0, seen: 0 }, // only 30 left
        { id: 'B', stack: 900, committed: 100, seen: 100 },
      ],
    });
    const la = legalActions(state, 'A');
    expect(la.canCall).toBe(true);
    expect(la.callAmount).toBe(30);
  });

  it('full raise: raiseMin = currentBetLevel + lastFullRaiseIncrement', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 1000, committed: 0, seen: 0 },
        { id: 'B', stack: 900,  committed: 100, seen: 100 },
      ],
    });
    const la = legalActions(state, 'A');
    expect(la.canRaise).toBe(true);
    expect(la.raiseMin).toBe(200); // 100 + 100
    expect(la.raiseMax).toBe(1000); // committed(0) + stack(1000)
  });

  // invariants.md §6 Rejected #2 — only all-in short raise is legal, not arbitrary sub-minimum
  it('raiseMin collapses to maxTo when full raise exceeds stack (short all-in only)', () => {
    // currentBetLevel=100, lastFullRaiseIncrement=100 → minFullTo=200
    // player has maxTo=120 (committed=0, stack=120). Cannot fully raise to 200.
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 120, committed: 0, seen: 0 },
        { id: 'B', stack: 880, committed: 100, seen: 100 },
      ],
    });
    const la = legalActions(state, 'A');
    expect(la.canRaise).toBe(true);
    expect(la.raiseMin).toBe(120); // only legal raise is all-in
    expect(la.raiseMax).toBe(120);
  });

  it('canRaise=false when maxTo <= currentBetLevel (cannot cover the current bet)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 30, committed: 0, seen: 0 }, // maxTo=30 < currentBetLevel=100
        { id: 'B', stack: 900, committed: 100, seen: 100 },
      ],
    });
    expect(legalActions(state, 'A').canRaise).toBe(false);
  });
});

// ── attempt ───────────────────────────────────────────────────────────────────

describe('attempt — PostBlind', () => {
  it('first PostBlind goes to Button (SB)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 0,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 100, committed: 0, seen: 0 },
      ],
    });
    const r = attempt(state, { kind: 'PostBlind', amount: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toMatchObject({ kind: 'BlindPosted', player: 'A', amount: 10 });
    }
  });

  it('second PostBlind goes to BB', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 10, lastFullBetLevel: 10, lastFullRaiseIncrement: 10,
      players: [
        { id: 'A', stack: 90, committed: 10, seen: 0 },
        { id: 'B', stack: 100, committed: 0, seen: 0 },
      ],
      history: [{ kind: 'BlindPosted', player: 'A', amount: 10 }],
    });
    const r = attempt(state, { kind: 'PostBlind', amount: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events[0]).toMatchObject({ kind: 'BlindPosted', player: 'B', amount: 20 });
    }
  });

  it('fails after both blinds posted', () => {
    const state = headsUpAfterBlinds();
    const r = attempt(state, { kind: 'PostBlind', amount: 10 });
    expect(r.ok).toBe(false);
  });
});

describe('attempt — Check', () => {
  it('legal when no bet (toCall==0)', () => {
    const state = makeState({
      street: 'flop',
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 0, seen: -1 },
        { id: 'B', stack: 80, committed: 0, seen: -1 },
      ],
    });
    // postflop firstToAct = B
    const r = attempt(state, { kind: 'Check' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events[0]).toMatchObject({ kind: 'ActionAccepted', player: 'B', command: { kind: 'Check' } });
  });

  it('illegal when there is a bet to call', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 900, committed: 50, seen: 50 },
      ],
    });
    const r = attempt(state, { kind: 'Check' });
    expect(r.ok).toBe(false);
  });
});

describe('attempt — Call', () => {
  it('produces ActionAccepted + ChipsCommitted', () => {
    const state = headsUpAfterBlinds();
    // A is currentActor preflop (Button), facing BB=20, committed=10, toCall=10
    const r = attempt(state, { kind: 'Call' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(2);
      expect(r.events[0]).toMatchObject({ kind: 'ActionAccepted', player: 'A', command: { kind: 'Call' } });
      expect(r.events[1]).toMatchObject({ kind: 'ChipsCommitted', player: 'A', amount: 10 });
    }
  });
});

describe('attempt — RaiseTo', () => {
  it('legal full raise produces ActionAccepted + ChipsCommitted', () => {
    const state = headsUpAfterBlinds(); // A to act, committed=10, currentBetLevel=20
    const r = attempt(state, { kind: 'RaiseTo', amount: 60 }); // 60-20=40 >= 20 ✓
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events[0]).toMatchObject({ kind: 'ActionAccepted', player: 'A', command: { kind: 'RaiseTo', amount: 60 } });
      expect(r.events[1]).toMatchObject({ kind: 'ChipsCommitted', player: 'A', amount: 50 }); // 60-10
    }
  });

  it('illegal: sub-minimum raise when not all-in (invariant §6 Rejected #2)', () => {
    // currentBetLevel=100, lastFullRaiseIncrement=100, player has plenty of chips
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 1100, committed: 0, seen: 0 },
        { id: 'B', stack: 900,  committed: 100, seen: 100 },
      ],
    });
    const r = attempt(state, { kind: 'RaiseTo', amount: 150 }); // 150-100=50 < 100, not all-in
    expect(r.ok).toBe(false);
  });

  it('legal: all-in short raise when stack < minFullTo', () => {
    // currentBetLevel=100, lastFullRaiseIncrement=100, player maxTo=120
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 120, committed: 0, seen: 0 },
        { id: 'B', stack: 880,  committed: 100, seen: 100 },
      ],
    });
    const r = attempt(state, { kind: 'RaiseTo', amount: 120 }); // == maxTo, legal
    expect(r.ok).toBe(true);
  });

  it('illegal: RaiseTo exactly at currentBetLevel', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 1000, committed: 0, seen: 0 },
        { id: 'B', stack: 900,  committed: 100, seen: 100 },
      ],
    });
    expect(attempt(state, { kind: 'RaiseTo', amount: 100 }).ok).toBe(false);
  });

  it('illegal: RaiseTo exceeds stack', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 50, committed: 0, seen: 0 },
        { id: 'B', stack: 900, committed: 100, seen: 100 },
      ],
    });
    expect(attempt(state, { kind: 'RaiseTo', amount: 200 }).ok).toBe(false);
  });
});

describe('attempt — no actor', () => {
  it('returns error when bettingRoundComplete', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 20, lastFullBetLevel: 20, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 20, seen: 20 },
        { id: 'B', stack: 80, committed: 20, seen: 20 },
      ],
    });
    expect(attempt(state, { kind: 'Check' }).ok).toBe(false);
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe('apply — BlindPosted', () => {
  it('updates stack, committedThisStreet, and bet levels', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 0,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 100, committed: 0, seen: 0 },
      ],
    });
    const s1 = apply(state, { kind: 'BlindPosted', player: 'A', amount: 10 });
    expect(s1.players.find(p => p.id === 'A')!.stack).toBe(90);
    expect(s1.players.find(p => p.id === 'A')!.committedThisStreet).toBe(10);
    expect(s1.currentBetLevel).toBe(10);
    expect(s1.lastFullBetLevel).toBe(10);
    expect(s1.lastFullRaiseIncrement).toBe(10);

    const s2 = apply(s1, { kind: 'BlindPosted', player: 'B', amount: 20 });
    expect(s2.currentBetLevel).toBe(20);
    expect(s2.lastFullBetLevel).toBe(20);
    expect(s2.lastFullRaiseIncrement).toBe(20);
    // seen stays 0 for both (invariants §6 — PostBlind does NOT update seen)
    expect(s2.players.find(p => p.id === 'A')!.seen).toBe(0);
    expect(s2.players.find(p => p.id === 'B')!.seen).toBe(0);
  });
});

describe('apply — ActionAccepted(RaiseTo) updates bet levels and seen', () => {
  it('full raise: updates lastFullBetLevel, lastFullRaiseIncrement, currentBetLevel, seen', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 950, committed: 0,  seen: 0 },
      ],
    });
    const s = apply(state, { kind: 'ActionAccepted', player: 'B', command: { kind: 'RaiseTo', amount: 150 } });
    expect(s.currentBetLevel).toBe(150);
    expect(s.lastFullBetLevel).toBe(150);
    expect(s.lastFullRaiseIncrement).toBe(100); // 150-50
    expect(s.players.find(p => p.id === 'B')!.seen).toBe(150);
  });

  it('short all-in raise: currentBetLevel updates, lastFullBetLevel stays, seen = old lastFullBetLevel', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 950, committed: 50, seen: 50 },
        { id: 'B', stack: 30,  committed: 0,  seen: 0 },
      ],
    });
    // B raises all-in to 80 (short: 80-50=30 < 50)
    const s = apply(state, { kind: 'ActionAccepted', player: 'B', command: { kind: 'RaiseTo', amount: 80 } });
    expect(s.currentBetLevel).toBe(80);
    expect(s.lastFullBetLevel).toBe(50); // unchanged
    expect(s.lastFullRaiseIncrement).toBe(50); // unchanged
    expect(s.players.find(p => p.id === 'B')!.seen).toBe(50); // seen = old lastFullBetLevel
  });
});

describe('apply — ActionAccepted(Fold)', () => {
  it('sets folded=true and updates seen', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 50, lastFullBetLevel: 50, lastFullRaiseIncrement: 50,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 950, committed: 50, seen: 50 },
      ],
    });
    const s = apply(state, { kind: 'ActionAccepted', player: 'A', command: { kind: 'Fold' } });
    expect(s.players.find(p => p.id === 'A')!.folded).toBe(true);
    expect(s.players.find(p => p.id === 'A')!.seen).toBe(50);
  });
});

describe('apply — BoardCardsRevealed resets street state (invariants §5)', () => {
  it('resets committedThisStreet, seen, currentBetLevel, lastFullBetLevel; sets lastFullRaiseIncrement=BB', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      bigBlind: 20,
      currentBetLevel: 60, lastFullBetLevel: 60, lastFullRaiseIncrement: 40,
      players: [
        { id: 'A', stack: 940, committed: 60, seen: 60 },
        { id: 'B', stack: 940, committed: 60, seen: 60 },
      ],
    });
    const s = apply(state, {
      kind: 'BoardCardsRevealed',
      street: 'flop',
      cards: [{ rank: 10, suit: 's' }, { rank: 11, suit: 'h' }, { rank: 12, suit: 'd' }],
    });
    expect(s.street).toBe('flop');
    expect(s.currentBetLevel).toBe(0);
    expect(s.lastFullBetLevel).toBe(0);
    expect(s.lastFullRaiseIncrement).toBe(20); // reset to BB
    for (const p of s.players) {
      expect(p.committedThisStreet).toBe(0);
      expect(p.seen).toBe(-1); // -1 sentinel: "hasn't acted this street"
    }
    expect(s.board).toHaveLength(3);
  });
});

// ── deriveNext ────────────────────────────────────────────────────────────────

describe('deriveNext', () => {
  it('ActionRequired when someone needs to act', () => {
    const state = headsUpAfterBlinds();
    const r = deriveNext(state);
    expect(r.kind).toBe('input');
    if (r.kind === 'input') {
      expect(r.request.kind).toBe('ActionRequired');
      if (r.request.kind === 'ActionRequired') expect(r.request.playerId).toBe('A');
    }
  });

  it('Reveal(flop,3) when preflop bettingRoundComplete and not terminal', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 20, lastFullBetLevel: 20, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 20, seen: 20 },
        { id: 'B', stack: 80, committed: 20, seen: 20 },
      ],
    });
    const r = deriveNext(state);
    expect(r.kind).toBe('input');
    if (r.kind === 'input') {
      expect(r.request).toMatchObject({ kind: 'Reveal', street: 'flop', count: 3 });
    }
  });

  it('done when hand is terminal (one player folded)', () => {
    const state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 20, lastFullBetLevel: 20, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 80,  committed: 20, seen: 0, folded: true },
      ],
    });
    expect(deriveNext(state)).toEqual({ kind: 'done' });
  });

  it('done on river + bettingRoundComplete', () => {
    const state = makeState({
      street: 'river',
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 20,
      players: [
        { id: 'A', stack: 80, committed: 0, seen: 0 },
        { id: 'B', stack: 80, committed: 0, seen: 0 },
      ],
    });
    expect(deriveNext(state)).toEqual({ kind: 'done' });
  });
});

// ── all-in run-out cascade (invariants §5) ────────────────────────────────────

describe('all-in run-out cascade', () => {
  it('both all-in on preflop: cascade through flop→turn→river via repeated Reveal requests', () => {
    // Start at preflop, both all-in (stack=0), betting already complete
    let state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 100, lastFullBetLevel: 100, lastFullRaiseIncrement: 100,
      players: [
        { id: 'A', stack: 0, committed: 100, seen: 100 },
        { id: 'B', stack: 0, committed: 100, seen: 100 },
      ],
    });

    expect(bettingRoundComplete(state)).toBe(true);
    expect(handTerminal(state)).toBe(false); // 2 players still eligible

    // Reveal flop
    let r = deriveNext(state);
    expect(r).toMatchObject({ kind: 'input', request: { kind: 'Reveal', street: 'flop', count: 3 } });
    state = apply(state, {
      kind: 'BoardCardsRevealed',
      street: 'flop',
      cards: [{ rank: 2, suit: 'c' }, { rank: 3, suit: 'd' }, { rank: 4, suit: 'h' }],
    });

    expect(bettingRoundComplete(state)).toBe(true); // both all-in, no action needed
    expect(handTerminal(state)).toBe(false);

    // Reveal turn
    r = deriveNext(state);
    expect(r).toMatchObject({ kind: 'input', request: { kind: 'Reveal', street: 'turn', count: 1 } });
    state = apply(state, { kind: 'BoardCardsRevealed', street: 'turn', cards: [{ rank: 5, suit: 's' }] });

    expect(bettingRoundComplete(state)).toBe(true);
    expect(handTerminal(state)).toBe(false);

    // Reveal river
    r = deriveNext(state);
    expect(r).toMatchObject({ kind: 'input', request: { kind: 'Reveal', street: 'river', count: 1 } });
    state = apply(state, { kind: 'BoardCardsRevealed', street: 'river', cards: [{ rank: 6, suit: 'c' }] });

    // Now river + bettingRoundComplete → terminal
    expect(handTerminal(state)).toBe(true);
    expect(deriveNext(state)).toEqual({ kind: 'done' });
    expect(state.board).toHaveLength(5);
  });
});

// ── full hand replay via attempt/apply pipeline ───────────────────────────────

describe('full heads-up hand: attempt → apply pipeline', () => {
  it('SB folds preflop → terminal in 1 action', () => {
    // Build hand from scratch via attempt/apply
    let state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 0,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 100, committed: 0, seen: 0 },
      ],
    });

    // Post blinds
    for (const [cmd, amount] of [['PostBlind', 10], ['PostBlind', 20]] as const) {
      const r = attempt(state, { kind: cmd, amount });
      expect(r.ok).toBe(true);
      if (r.ok) for (const ev of r.events) state = apply(state, ev);
    }

    expect(state.currentBetLevel).toBe(20);
    expect(currentActor(state)).toBe('A'); // SB acts first preflop

    // A (SB/Button) folds
    const r = attempt(state, { kind: 'Fold' });
    expect(r.ok).toBe(true);
    if (r.ok) for (const ev of r.events) state = apply(state, ev);

    expect(state.players.find(p => p.id === 'A')!.folded).toBe(true);
    expect(handTerminal(state)).toBe(true);
    expect(deriveNext(state)).toEqual({ kind: 'done' });
  });

  it('SB calls, BB checks → advance to flop', () => {
    let state = makeState({
      seatOrder: ['A', 'B'], buttonSeat: 'A',
      currentBetLevel: 0, lastFullBetLevel: 0, lastFullRaiseIncrement: 0,
      players: [
        { id: 'A', stack: 100, committed: 0, seen: 0 },
        { id: 'B', stack: 100, committed: 0, seen: 0 },
      ],
    });

    const applyAttempt = (cmd: Parameters<typeof attempt>[1]) => {
      const r = attempt(state, cmd);
      expect(r.ok).toBe(true);
      if (r.ok) for (const ev of r.events) state = apply(state, ev);
    };

    applyAttempt({ kind: 'PostBlind', amount: 10 });
    applyAttempt({ kind: 'PostBlind', amount: 20 });
    applyAttempt({ kind: 'Call' });   // A calls (10 more → committed=20)
    applyAttempt({ kind: 'Check' });  // B checks (BB option)

    expect(bettingRoundComplete(state)).toBe(true);
    expect(handTerminal(state)).toBe(false);

    const d = deriveNext(state);
    expect(d).toMatchObject({ kind: 'input', request: { kind: 'Reveal', street: 'flop', count: 3 } });
  });
});
