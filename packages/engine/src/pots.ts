import type { PlayerId, Amount, GameState } from './gameState.js';
import type { Card } from './cards.js';

export interface Pot {
  id: number;
  amount: Amount;
  eligible: PlayerId[];
}

// Layer-stripping over distinct commitment levels (invariants.md §7).
export function settlePots(
  commitments: Map<PlayerId, Amount>,
  folded: Set<PlayerId>
): Pot[] {
  const levels = [...new Set(commitments.values())]
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  const result: Pot[] = [];
  let prevSum = 0;
  let id = 0;

  for (const level of levels) {
    let curSum = 0;
    for (const amt of commitments.values()) curSum += Math.min(amt, level);

    const amount = curSum - prevSum;
    const eligible = [...commitments.entries()]
      .filter(([pid, amt]) => amt >= level && !folded.has(pid))
      .map(([pid]) => pid);

    if (amount > 0) {
      if (eligible.length === 0 && result.length > 0) {
        // All players at this level are folded; their chips accrue to the nearest eligible pot.
        result[result.length - 1]!.amount += amount;
      } else if (eligible.length > 0) {
        result.push({ id: id++, amount, eligible });
      }
    }
    prevSum = curSum;
  }

  return result;
}

// Sum all ChipsCommitted and BlindPosted events across the hand history.
export function totalCommitments(state: GameState): Map<PlayerId, Amount> {
  const map = new Map<PlayerId, Amount>();
  for (const ev of state.history) {
    if (ev.kind === 'ChipsCommitted' || ev.kind === 'BlindPosted') {
      map.set(ev.player, (map.get(ev.player) ?? 0) + ev.amount);
    }
  }
  return map;
}

// Derived query: pots from hand history + current folded status (invariants.md §7).
export function pots(state: GameState): Pot[] {
  const commitments = totalCommitments(state);
  const folded = new Set(state.players.filter(p => p.folded).map(p => p.id));
  return settlePots(commitments, folded);
}

// Injected to keep engine independent of math package (SPEC.md: engine → nothing).
export type BestHandFn = (playerIds: PlayerId[], board: Card[]) => PlayerId[];

// Distribute each pot: floor-divide, odd chip(s) to seats earliest after button (invariants.md §7).
export function payouts(state: GameState, bestHand: BestHandFn): Map<PlayerId, Amount> {
  const result = new Map<PlayerId, Amount>();
  for (const p of state.players) result.set(p.id, 0);

  const btnIdx = state.seatOrder.indexOf(state.buttonSeat);
  const priorityOrder = [
    ...state.seatOrder.slice(btnIdx + 1),
    ...state.seatOrder.slice(0, btnIdx + 1),
  ];

  for (const pot of pots(state)) {
    if (pot.eligible.length === 0) continue;

    const winners = pot.eligible.length === 1
      ? pot.eligible
      : bestHand(pot.eligible, state.board);

    const share = Math.floor(pot.amount / winners.length);
    const rem = pot.amount % winners.length;
    const winnerSet = new Set(winners);
    const order = priorityOrder.filter(pid => winnerSet.has(pid));

    for (let i = 0; i < order.length; i++) {
      const pid = order[i]!;
      result.set(pid, (result.get(pid) ?? 0) + share + (i < rem ? 1 : 0));
    }
  }

  return result;
}
