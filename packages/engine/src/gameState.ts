import type { Card } from './cards.js';
import type { TransitionEvent } from './transitions.js';

export type PlayerId = string;
export type Amount = number;
export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface PlayerState {
  id: PlayerId;
  seat: number;
  stack: Amount;
  committedThisStreet: Amount;
  folded: boolean;
  holeCards: { cards: [Card, Card] } | null;
  seen: Amount; // -1 = "hasn't acted this street yet" (sentinel); >=0 = lastFullBetLevel at time of last action
}

export interface GameState {
  id: string;
  variant: 'nlhe';
  street: Street;
  seatOrder: PlayerId[];
  buttonSeat: PlayerId;
  bigBlind: Amount;
  currentBetLevel: Amount;
  lastFullBetLevel: Amount;
  lastFullRaiseIncrement: Amount;
  players: PlayerState[];
  board: Card[];
  history: TransitionEvent[];
}
