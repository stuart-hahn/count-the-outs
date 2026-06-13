import type { Card, Rank, Suit } from '@count-the-outs/engine';
import { parseCard } from '@count-the-outs/engine';

export type Weight = number;
export type Range = ReadonlyMap<string, Weight>;

const RANK_CHARS: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

const RANK_STRS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const SUIT_ORDER: Record<Suit, number> = { c: 0, d: 1, h: 2, s: 3 };
const ALL_SUITS: Suit[] = ['c', 'd', 'h', 's'];
const ALL_RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function cardStr(c: Card): string {
  return `${RANK_STRS[c.rank]!}${c.suit}`;
}

export function comboKey(a: Card, b: Card): string {
  const aFirst =
    a.rank > b.rank ||
    (a.rank === b.rank && SUIT_ORDER[a.suit] < SUIT_ORDER[b.suit]);
  return aFirst ? `${cardStr(a)}_${cardStr(b)}` : `${cardStr(b)}_${cardStr(a)}`;
}

export function keyToCombo(key: string): [Card, Card] {
  const us = key.indexOf('_');
  return [parseCard(key.slice(0, us)), parseCard(key.slice(us + 1))];
}

/** invariants.md §11 — filter combos that share a card with deadCards */
export function effectiveRange(range: Range, deadCards: readonly Card[]): Map<string, Weight> {
  const dead = new Set(deadCards.map(cardStr));
  const result = new Map<string, Weight>();
  for (const [key, weight] of range) {
    const [a, b] = keyToCombo(key);
    if (!dead.has(cardStr(a)) && !dead.has(cardStr(b))) result.set(key, weight);
  }
  return result;
}

// ── parsing ────────────────────────────────────────────────────────────────────

type Suitedness = 'suited' | 'offsuit' | 'both';

function handCombos(r1: Rank, r2: Rank, suit: Suitedness): [Card, Card][] {
  const result: [Card, Card][] = [];
  if (r1 === r2) {
    for (let i = 0; i < ALL_SUITS.length; i++) {
      for (let j = i + 1; j < ALL_SUITS.length; j++) {
        result.push([{ rank: r1, suit: ALL_SUITS[i]! }, { rank: r1, suit: ALL_SUITS[j]! }]);
      }
    }
    return result;
  }
  const hi: Rank = r1 > r2 ? r1 : r2;
  const lo: Rank = r1 > r2 ? r2 : r1;
  if (suit === 'suited' || suit === 'both') {
    for (const s of ALL_SUITS) result.push([{ rank: hi, suit: s }, { rank: lo, suit: s }]);
  }
  if (suit === 'offsuit' || suit === 'both') {
    for (const s1 of ALL_SUITS) {
      for (const s2 of ALL_SUITS) {
        if (s1 !== s2) result.push([{ rank: hi, suit: s1 }, { rank: lo, suit: s2 }]);
      }
    }
  }
  return result;
}

function addCombos(into: Map<string, Weight>, combos: [Card, Card][], w: Weight): void {
  for (const [a, b] of combos) into.set(comboKey(a, b), w);
}

interface HandBase { r1: Rank; r2: Rank; suit: Suitedness }

function parseBase(token: string): HandBase {
  if (token.length === 2) {
    const r1 = RANK_CHARS[token[0]!];
    const r2 = RANK_CHARS[token[1]!];
    if (r1 === undefined || r2 === undefined) throw new Error(`Invalid hand: "${token}"`);
    return { r1, r2, suit: 'both' };
  }
  if (token.length === 3) {
    const r1 = RANK_CHARS[token[0]!];
    const r2 = RANK_CHARS[token[1]!];
    const sc = token[2];
    if (r1 === undefined || r2 === undefined) throw new Error(`Invalid hand: "${token}"`);
    if (sc !== 's' && sc !== 'o') throw new Error(`Expected 's' or 'o' in: "${token}"`);
    return { r1, r2, suit: sc === 's' ? 'suited' : 'offsuit' };
  }
  throw new Error(`Invalid hand token: "${token}"`);
}

function parseToken(raw: string, into: Map<string, Weight>): void {
  let token = raw;
  let weight: Weight = 1;
  const ci = raw.indexOf(':');
  if (ci >= 0) {
    weight = parseFloat(raw.slice(ci + 1));
    token = raw.slice(0, ci);
    if (isNaN(weight)) throw new Error(`Invalid weight in: "${raw}"`);
  }

  // Specific combo: e.g., AhKs
  if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/.test(token)) {
    into.set(comboKey(parseCard(token.slice(0, 2)), parseCard(token.slice(2))), weight);
    return;
  }

  // Plus range: QQ+, ATs+, ATo+
  if (token.endsWith('+')) {
    const { r1, r2, suit } = parseBase(token.slice(0, -1));
    if (r1 === r2) {
      for (const r of ALL_RANKS.filter(r => r >= r1)) addCombos(into, handCombos(r, r, 'both'), weight);
    } else {
      const hi: Rank = r1 > r2 ? r1 : r2;
      const loBase: Rank = r1 > r2 ? r2 : r1;
      for (const lo of ALL_RANKS.filter(r => r >= loBase && r < hi)) {
        addCombos(into, handCombos(hi, lo, suit), weight);
      }
    }
    return;
  }

  // Dash range: JJ-99, KQs-KTs, AKo-ATo
  const di = token.indexOf('-');
  if (di > 0) {
    const partA = parseBase(token.slice(0, di));
    const partB = parseBase(token.slice(di + 1));
    const isPair = partA.r1 === partA.r2 && partB.r1 === partB.r2;
    if (isPair) {
      const loR: Rank = partA.r1 < partB.r1 ? partA.r1 : partB.r1;
      const hiR: Rank = partA.r1 < partB.r1 ? partB.r1 : partA.r1;
      for (const r of ALL_RANKS.filter(r => r >= loR && r <= hiR)) {
        addCombos(into, handCombos(r, r, 'both'), weight);
      }
    } else {
      if (partA.r1 !== partB.r1) throw new Error(`Non-pair dash range must share fixed card: "${token}"`);
      if (partA.suit !== partB.suit) throw new Error(`Dash range suitedness must match: "${token}"`);
      const fixed = partA.r1;
      const loK: Rank = partA.r2 < partB.r2 ? partA.r2 : partB.r2;
      const hiK: Rank = partA.r2 < partB.r2 ? partB.r2 : partA.r2;
      for (const k of ALL_RANKS.filter(r => r >= loK && r <= hiK)) {
        addCombos(into, handCombos(fixed, k, partA.suit), weight);
      }
    }
    return;
  }

  const { r1, r2, suit } = parseBase(token);
  addCombos(into, handCombos(r1, r2, suit), weight);
}

/** Parse comma/space-separated range notation into a Range map. */
export function parseRange(notation: string): Map<string, Weight> {
  const result = new Map<string, Weight>();
  for (const token of notation.split(/[,\s]+/).filter(t => t.length > 0)) {
    parseToken(token, result);
  }
  return result;
}
