export type Suit = 'c' | 'd' | 'h' | 's';

// 2–10 face value; J=11, Q=12, K=13, A=14
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

const RANK_MAP: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

const ALL_SUITS: Suit[] = ['c', 'd', 'h', 's'];
const ALL_RANKS = Object.values(RANK_MAP) as Rank[];

/** Parse compact notation: "As", "Td", "2c" */
export function parseCard(notation: string): Card {
  const rankStr = notation.slice(0, -1);
  const suit = notation.slice(-1) as Suit;
  const rank = RANK_MAP[rankStr];
  if (rank === undefined) throw new Error(`Invalid card notation: ${notation}`);
  return { rank, suit };
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}
