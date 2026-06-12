import type { Card } from '@count-the-outs/engine';

export enum HandCategory {
  HighCard      = 1,
  OnePair       = 2,
  TwoPair       = 3,
  ThreeOfAKind  = 4,
  Straight      = 5,
  Flush         = 6,
  FullHouse     = 7,
  FourOfAKind   = 8,
  StraightFlush = 9,
}

export interface HandRank {
  category: HandCategory;
  tiebreaks: number[];
}

export function compareHandRank(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.tiebreaks.length, b.tiebreaks.length); i++) {
    const d = (a.tiebreaks[i] ?? 0) - (b.tiebreaks[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function combinations(cards: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (cards.length < k) return [];
  const [first, ...rest] = cards;
  return [
    ...combinations(rest, k - 1).map(c => [first!, ...c]),
    ...combinations(rest, k),
  ];
}

interface Group { rank: number; count: number; }

function getGroups(sortedRanks: number[]): Group[] {
  const counts = new Map<number, number>();
  for (const r of sortedRanks) counts.set(r, (counts.get(r) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
}

function getStraightHigh(sortedRanks: number[]): number | null {
  const seq = sortedRanks.every((r, i) => i === 0 || r === sortedRanks[i - 1]! - 1);
  if (seq) return sortedRanks[0]!;
  // Wheel: A-2-3-4-5; ace plays as 1, straight ranks as 5-high
  const isWheel =
    sortedRanks[0] === 14 &&
    sortedRanks[1] === 5 &&
    sortedRanks[2] === 4 &&
    sortedRanks[3] === 3 &&
    sortedRanks[4] === 2;
  return isWheel ? 5 : null;
}

function eval5(cards: Card[]): HandRank {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const straightHigh = getStraightHigh(ranks);

  if (isFlush && straightHigh !== null) {
    return { category: HandCategory.StraightFlush, tiebreaks: [straightHigh] };
  }

  const groups = getGroups(ranks);

  if (groups[0]!.count === 4) {
    return { category: HandCategory.FourOfAKind, tiebreaks: [groups[0]!.rank, groups[1]!.rank] };
  }

  if (groups[0]!.count === 3 && groups[1]!.count === 2) {
    return { category: HandCategory.FullHouse, tiebreaks: [groups[0]!.rank, groups[1]!.rank] };
  }

  if (isFlush) {
    return { category: HandCategory.Flush, tiebreaks: ranks };
  }

  if (straightHigh !== null) {
    return { category: HandCategory.Straight, tiebreaks: [straightHigh] };
  }

  if (groups[0]!.count === 3) {
    const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
    return { category: HandCategory.ThreeOfAKind, tiebreaks: [groups[0]!.rank, ...kickers] };
  }

  if (groups[0]!.count === 2 && groups[1]!.count === 2) {
    return { category: HandCategory.TwoPair, tiebreaks: [groups[0]!.rank, groups[1]!.rank, groups[2]!.rank] };
  }

  if (groups[0]!.count === 2) {
    const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
    return { category: HandCategory.OnePair, tiebreaks: [groups[0]!.rank, ...kickers] };
  }

  return { category: HandCategory.HighCard, tiebreaks: ranks };
}

/** Rank 5–7 cards, returning the best 5-card HandRank. */
export function rank(cards: Card[]): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`rank requires 5–7 cards, got ${cards.length}`);
  }
  if (cards.length === 5) return eval5(cards);
  return combinations(cards, 5)
    .map(eval5)
    .reduce((best, cur) => compareHandRank(cur, best) > 0 ? cur : best);
}
