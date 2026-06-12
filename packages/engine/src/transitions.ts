import type { Card } from './cards.js';
import type { PlayerId, Amount, Street } from './gameState.js';

export type Command =
  | { kind: 'Check' }
  | { kind: 'Fold' }
  | { kind: 'Call' }
  | { kind: 'RaiseTo'; amount: Amount }
  | { kind: 'PostBlind'; amount: Amount };

export type TransitionEvent =
  | { kind: 'BlindPosted'; player: PlayerId; amount: Amount }
  | { kind: 'HoleCardsAssigned'; player: PlayerId; cards: [Card, Card] }
  | { kind: 'ActionAccepted'; player: PlayerId; command: Command }
  | { kind: 'ChipsCommitted'; player: PlayerId; amount: Amount }
  | { kind: 'BoardCardsRevealed'; street: Street; cards: Card[] }
  | { kind: 'CardsShown'; player: PlayerId }
  | { kind: 'CardsMucked'; player: PlayerId };
