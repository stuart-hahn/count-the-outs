import type { PlayerId, Amount, GameState, PlayerState } from './gameState.js';
import type { BestHandFn } from './pots.js';
import { payouts } from './pots.js';

export interface TableState {
  seatOrder: PlayerId[];
  buttonSeat: PlayerId;
  stacks: Map<PlayerId, Amount>;
  handNumber: number;
  bigBlind: Amount;
}

// First seat after currentButton (wrapping) where stack > 0. Invariants §8.
export function nextButton(
  seatOrder: PlayerId[],
  buttonSeat: PlayerId,
  stacks: Map<PlayerId, Amount>
): PlayerId {
  const idx = seatOrder.indexOf(buttonSeat);
  if (idx === -1) throw new Error(`buttonSeat not in seatOrder: ${buttonSeat}`);
  const n = seatOrder.length;
  for (let i = 1; i <= n; i++) {
    const id = seatOrder[(idx + i) % n]!;
    if ((stacks.get(id) ?? 0) > 0) return id;
  }
  throw new Error('nextButton: no active player found');
}

// Create fresh GameState for a new hand. Blinds not yet posted.
export function startHand(table: TableState): GameState {
  const players: PlayerState[] = table.seatOrder.map((id, seat) => ({
    id,
    seat,
    stack: table.stacks.get(id) ?? 0,
    committedThisStreet: 0,
    folded: false,
    holeCards: null,
    seen: -1,
  }));

  return {
    id: String(table.handNumber),
    variant: 'nlhe',
    street: 'preflop',
    seatOrder: [...table.seatOrder],
    buttonSeat: table.buttonSeat,
    bigBlind: table.bigBlind,
    currentBetLevel: 0,
    lastFullBetLevel: 0,
    lastFullRaiseIncrement: table.bigBlind,
    players,
    board: [],
    history: [],
  };
}

// Produce next TableState from a terminal GameState. Eliminates bust players.
export function endHand(
  table: TableState,
  finalState: GameState,
  bestHand: BestHandFn
): TableState {
  const payoutMap = payouts(finalState, bestHand);

  const newStacks = new Map<PlayerId, Amount>();
  for (const p of finalState.players) {
    newStacks.set(p.id, p.stack + (payoutMap.get(p.id) ?? 0));
  }

  // Rotate button before eliminating bust seats so wrapping still works when
  // the current buttonSeat goes bust.
  const newButtonSeat = nextButton(table.seatOrder, table.buttonSeat, newStacks);

  const newSeatOrder = table.seatOrder.filter(id => (newStacks.get(id) ?? 0) > 0);
  for (const id of [...newStacks.keys()]) {
    if (newStacks.get(id) === 0) newStacks.delete(id);
  }

  return {
    seatOrder: newSeatOrder,
    buttonSeat: newButtonSeat,
    stacks: newStacks,
    handNumber: table.handNumber + 1,
    bigBlind: table.bigBlind,
  };
}
