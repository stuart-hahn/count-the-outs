import { describe, expect, it } from 'vitest';
import { rank, compareHandRank, HandCategory } from '../src/handEvaluator';
import { parseCard } from '@count-the-outs/engine';
import type { HandRank } from '../src/handEvaluator';

function cards(...notations: string[]) {
  return notations.map(parseCard);
}

function hr(category: HandCategory, ...tiebreaks: number[]): HandRank {
  return { category, tiebreaks };
}

// ─── category detection ───────────────────────────────────────────────────────

describe('StraightFlush', () => {
  it('royal flush (A-high SF)', () => {
    expect(rank(cards('As', 'Ks', 'Qs', 'Js', 'Ts'))).toEqual(
      hr(HandCategory.StraightFlush, 14),
    );
  });

  it('9-high SF', () => {
    expect(rank(cards('9h', '8h', '7h', '6h', '5h'))).toEqual(
      hr(HandCategory.StraightFlush, 9),
    );
  });

  it('wheel SF (A2345 suited) — ace plays as 1, ranks as 5-high', () => {
    expect(rank(cards('Ac', '5c', '4c', '3c', '2c'))).toEqual(
      hr(HandCategory.StraightFlush, 5),
    );
  });

  it('wheel SF ranks below 6-high SF', () => {
    const wheel = rank(cards('Ac', '5c', '4c', '3c', '2c'));
    const sixHigh = rank(cards('6c', '5c', '4c', '3c', '2c'));
    expect(compareHandRank(wheel, sixHigh)).toBeLessThan(0);
  });
});

describe('FourOfAKind', () => {
  it('four aces with K kicker', () => {
    expect(rank(cards('Ac', 'Ad', 'Ah', 'As', 'Kd'))).toEqual(
      hr(HandCategory.FourOfAKind, 14, 13),
    );
  });

  it('four 2s with A kicker', () => {
    expect(rank(cards('2c', '2d', '2h', '2s', 'Ac'))).toEqual(
      hr(HandCategory.FourOfAKind, 2, 14),
    );
  });

  it('kicker breaks tie between same quads', () => {
    const withAce = rank(cards('2c', '2d', '2h', '2s', 'Ac'));
    const withKing = rank(cards('2c', '2d', '2h', '2s', 'Kc'));
    expect(compareHandRank(withAce, withKing)).toBeGreaterThan(0);
  });

  it('lower quads lose to higher quads regardless of kicker', () => {
    const quads2withA = rank(cards('2c', '2d', '2h', '2s', 'Ac'));
    const quads3with2 = rank(cards('3c', '3d', '3h', '3s', '2c'));
    expect(compareHandRank(quads3with2, quads2withA)).toBeGreaterThan(0);
  });
});

describe('FullHouse', () => {
  it('aces full of kings', () => {
    expect(rank(cards('Ac', 'Ad', 'Ah', 'Kc', 'Kd'))).toEqual(
      hr(HandCategory.FullHouse, 14, 13),
    );
  });

  it('trips rank is primary: AAA KK > KKK AA', () => {
    const aaakk = rank(cards('Ac', 'Ad', 'Ah', 'Kc', 'Kd'));
    const kkkaa = rank(cards('Kc', 'Kd', 'Kh', 'Ac', 'Ad'));
    expect(compareHandRank(aaakk, kkkaa)).toBeGreaterThan(0);
  });

  it('pair rank breaks tie when trips rank equal: KKK QQ > KKK JJ', () => {
    const kkkqq = rank(cards('Kc', 'Kd', 'Kh', 'Qc', 'Qd'));
    const kkkjj = rank(cards('Kc', 'Kd', 'Kh', 'Jc', 'Jd'));
    expect(compareHandRank(kkkqq, kkkjj)).toBeGreaterThan(0);
  });
});

describe('Flush', () => {
  it('A-K-Q-J-9 flush', () => {
    expect(rank(cards('As', 'Ks', 'Qs', 'Js', '9s'))).toEqual(
      hr(HandCategory.Flush, 14, 13, 12, 11, 9),
    );
  });

  it('5th card (lowest) breaks flush tie', () => {
    const akqj9 = rank(cards('As', 'Ks', 'Qs', 'Js', '9s'));
    const akqj8 = rank(cards('As', 'Ks', 'Qs', 'Js', '8s'));
    expect(compareHandRank(akqj9, akqj8)).toBeGreaterThan(0);
  });

  it('first differing card determines winner', () => {
    const akqj9 = rank(cards('As', 'Ks', 'Qs', 'Js', '9s'));
    const akqt9 = rank(cards('As', 'Ks', 'Qs', 'Ts', '9s'));
    expect(compareHandRank(akqj9, akqt9)).toBeGreaterThan(0);
  });
});

describe('Straight', () => {
  it('broadway (A-high)', () => {
    expect(rank(cards('Ac', 'Kd', 'Qh', 'Js', 'Tc'))).toEqual(
      hr(HandCategory.Straight, 14),
    );
  });

  it('wheel A2345 — ace plays low, ranks as 5-high', () => {
    expect(rank(cards('Ac', '5d', '4h', '3s', '2c'))).toEqual(
      hr(HandCategory.Straight, 5),
    );
  });

  it('wheel ranks below 6-high straight', () => {
    const wheel = rank(cards('Ac', '5d', '4h', '3s', '2c'));
    const sixHigh = rank(cards('6c', '5d', '4h', '3s', '2c'));
    expect(compareHandRank(wheel, sixHigh)).toBeLessThan(0);
  });

  it('9-high straight', () => {
    expect(rank(cards('9c', '8d', '7h', '6s', '5c'))).toEqual(
      hr(HandCategory.Straight, 9),
    );
  });

  it('higher straight beats lower', () => {
    const broadway = rank(cards('Ac', 'Kd', 'Qh', 'Js', 'Tc'));
    const nineHigh = rank(cards('9c', '8d', '7h', '6s', '5c'));
    expect(compareHandRank(broadway, nineHigh)).toBeGreaterThan(0);
  });
});

describe('ThreeOfAKind', () => {
  it('trip aces with K-Q kickers', () => {
    expect(rank(cards('Ac', 'Ad', 'Ah', 'Kd', 'Qd'))).toEqual(
      hr(HandCategory.ThreeOfAKind, 14, 13, 12),
    );
  });

  it('top kicker breaks trips tie: AAA KQ > AAA KJ', () => {
    const aakq = rank(cards('Ac', 'Ad', 'Ah', 'Kd', 'Qd'));
    const aakj = rank(cards('Ac', 'Ad', 'Ah', 'Kd', 'Jd'));
    expect(compareHandRank(aakq, aakj)).toBeGreaterThan(0);
  });

  it('second kicker breaks when first kicker ties: AAA KQ > AAA KJ confirmed by 2nd kicker', () => {
    const aakq = rank(cards('Ac', 'Ad', 'Ah', 'Kd', 'Qd'));
    const aakj = rank(cards('Ac', 'Ad', 'Ah', 'Kd', 'Jd'));
    expect(compareHandRank(aakq, aakj)).toBeGreaterThan(0);
  });
});

describe('TwoPair', () => {
  it('aces and kings with Q kicker', () => {
    expect(rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Qd'))).toEqual(
      hr(HandCategory.TwoPair, 14, 13, 12),
    );
  });

  it('high pair is primary: AA KK > KK QQ', () => {
    const aakk = rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Qd'));
    const kkqq = rank(cards('Kc', 'Kd', 'Qc', 'Qd', 'Jd'));
    expect(compareHandRank(aakk, kkqq)).toBeGreaterThan(0);
  });

  it('low pair breaks tie when high pair equal: AA KK > AA QQ', () => {
    const aakk = rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Qd'));
    const aaqq = rank(cards('Ac', 'Ad', 'Qc', 'Qd', 'Kd'));
    expect(compareHandRank(aakk, aaqq)).toBeGreaterThan(0);
  });

  it('kicker breaks tie when both pairs equal: AA KK Q > AA KK J', () => {
    const aakkq = rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Qd'));
    const aakkj = rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Jd'));
    expect(compareHandRank(aakkq, aakkj)).toBeGreaterThan(0);
  });
});

describe('OnePair', () => {
  it('pair of aces with K-Q-J kickers', () => {
    expect(rank(cards('Ac', 'Ad', 'Kc', 'Qd', 'Jd'))).toEqual(
      hr(HandCategory.OnePair, 14, 13, 12, 11),
    );
  });

  it('pair rank is primary', () => {
    const pairA = rank(cards('Ac', 'Ad', '2c', '3d', '4h'));
    const pairK = rank(cards('Kc', 'Kd', 'Ac', 'Qd', 'Jh'));
    expect(compareHandRank(pairA, pairK)).toBeGreaterThan(0);
  });

  it('kickers resolve tie in order: AA KQJ > AA KQT', () => {
    const aakqj = rank(cards('Ac', 'Ad', 'Kc', 'Qd', 'Jd'));
    const aakqt = rank(cards('Ac', 'Ad', 'Kc', 'Qd', 'Td'));
    expect(compareHandRank(aakqj, aakqt)).toBeGreaterThan(0);
  });
});

describe('HighCard', () => {
  it('A-K-Q-J-9', () => {
    expect(rank(cards('Ac', 'Kd', 'Qh', 'Js', '9c'))).toEqual(
      hr(HandCategory.HighCard, 14, 13, 12, 11, 9),
    );
  });

  it('first differing card determines winner', () => {
    const akqj9 = rank(cards('Ac', 'Kd', 'Qh', 'Js', '9c'));
    const akqj8 = rank(cards('Ac', 'Kd', 'Qh', 'Js', '8c'));
    expect(compareHandRank(akqj9, akqj8)).toBeGreaterThan(0);
  });
});

// ─── category ordering ────────────────────────────────────────────────────────

describe('category ordering', () => {
  // Use the weakest possible hand in each higher category
  // vs the strongest in each lower category to prove category beats category.

  it('SF > quads (low SF vs quad aces)', () => {
    const sf = rank(cards('6c', '5c', '4c', '3c', '2c')); // 6-high SF
    const quads = rank(cards('Ac', 'Ad', 'Ah', 'As', 'Kd'));
    expect(compareHandRank(sf, quads)).toBeGreaterThan(0);
  });

  it('quads > full house (low quads vs aces full)', () => {
    const quads = rank(cards('2c', '2d', '2h', '2s', '3d'));
    const boat = rank(cards('Ac', 'Ad', 'Ah', 'Kc', 'Kd'));
    expect(compareHandRank(quads, boat)).toBeGreaterThan(0);
  });

  it('full house > flush (low boat vs A-high flush)', () => {
    const boat = rank(cards('2c', '2d', '2h', '3c', '3d'));
    const flush = rank(cards('As', 'Ks', 'Qs', 'Js', '9s'));
    expect(compareHandRank(boat, flush)).toBeGreaterThan(0);
  });

  it('flush beats broadway straight — category wins regardless of card ranks', () => {
    // broadway straight (A-high) vs T-high flush
    const broadway = rank(cards('Ac', 'Kd', 'Qh', 'Js', 'Tc'));
    const lowFlush = rank(cards('2s', '4s', '6s', '8s', 'Ts'));
    expect(compareHandRank(lowFlush, broadway)).toBeGreaterThan(0);
  });

  it('straight > trips (low straight vs trip aces)', () => {
    const straight = rank(cards('5c', '6d', '7h', '8s', '9c'));
    const trips = rank(cards('Ac', 'Ad', 'Ah', 'Kd', 'Qd'));
    expect(compareHandRank(straight, trips)).toBeGreaterThan(0);
  });

  it('trips > two pair (low trips vs AAKK)', () => {
    const trips = rank(cards('2c', '2d', '2h', '3c', '4d'));
    const twoPair = rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Qd'));
    expect(compareHandRank(trips, twoPair)).toBeGreaterThan(0);
  });

  it('two pair > one pair (low two pair vs pair of aces)', () => {
    const twoPair = rank(cards('2c', '2d', '3c', '3d', '4h'));
    const onePair = rank(cards('Ac', 'Ad', 'Kc', 'Qd', 'Jd'));
    expect(compareHandRank(twoPair, onePair)).toBeGreaterThan(0);
  });

  it('one pair > high card (low pair vs A-high)', () => {
    const pair = rank(cards('2c', '2d', '3c', '4d', '5h'));
    const high = rank(cards('Ac', 'Kd', 'Qh', 'Js', '9c'));
    expect(compareHandRank(pair, high)).toBeGreaterThan(0);
  });
});

// ─── SF vs flush vs straight disambiguation ───────────────────────────────────

describe('SF / flush / straight disambiguation', () => {
  it('same-suited connectors form SF, not flush', () => {
    const r = rank(cards('9h', '8h', '7h', '6h', '5h'));
    expect(r.category).toBe(HandCategory.StraightFlush);
  });

  it('flush beats straight when card ranks equal in value but not same suit', () => {
    // Both hands contain A K Q J T; mixed suit = straight, same suit = SF
    const mixed = rank(cards('Ac', 'Kd', 'Qh', 'Js', 'Tc')); // straight
    const suited = rank(cards('Ah', 'Kh', 'Qh', 'Jh', 'Th')); // royal SF
    expect(compareHandRank(suited, mixed)).toBeGreaterThan(0);
  });

  it('non-sequential suited cards are flush, not SF', () => {
    const r = rank(cards('As', 'Ks', 'Qs', 'Js', '9s')); // no 10, not sequential
    expect(r.category).toBe(HandCategory.Flush);
  });

  it('wheel SF (A2345s) is SF not straight', () => {
    const r = rank(cards('Ah', '5h', '4h', '3h', '2h'));
    expect(r.category).toBe(HandCategory.StraightFlush);
  });

  it('wheel straight (A2345o) is Straight not HighCard', () => {
    const r = rank(cards('Ac', '5d', '4h', '3s', '2c'));
    expect(r.category).toBe(HandCategory.Straight);
  });
});

// ─── ties ─────────────────────────────────────────────────────────────────────

describe('ties', () => {
  it('identical hand ranks compare equal', () => {
    const r1 = rank(cards('Ac', 'Kc', 'Qc', 'Jc', '9c')); // A-high flush clubs
    const r2 = rank(cards('Ad', 'Kd', 'Qd', 'Jd', '9d')); // A-high flush diamonds
    expect(compareHandRank(r1, r2)).toBe(0);
  });

  it('identical straights compare equal', () => {
    const r1 = rank(cards('Ac', 'Kd', 'Qh', 'Js', 'Tc'));
    const r2 = rank(cards('Ah', 'Kc', 'Qd', 'Jh', 'Ts'));
    expect(compareHandRank(r1, r2)).toBe(0);
  });

  it('identical wheel straights compare equal', () => {
    const r1 = rank(cards('Ac', '5d', '4h', '3s', '2c'));
    const r2 = rank(cards('Ad', '5c', '4s', '3h', '2d'));
    expect(compareHandRank(r1, r2)).toBe(0);
  });
});

// ─── 7-card best-hand selection ───────────────────────────────────────────────

describe('7-card best-hand selection', () => {
  it('picks SF from 7 cards', () => {
    // Kh Qh Jh Th 9h + Ac 2d → K-high SF
    const r = rank(cards('Kh', 'Qh', 'Jh', 'Th', '9h', 'Ac', '2d'));
    expect(r).toEqual(hr(HandCategory.StraightFlush, 13));
  });

  it('picks flush over pair when both present', () => {
    // 5 spades + two kings (pair)
    const r = rank(cards('2s', '4s', '6s', '8s', 'Ts', 'Kc', 'Kd'));
    expect(r.category).toBe(HandCategory.Flush);
  });

  it('picks best two-pair kicker from 7 cards: AA KK Q beats AA KK J', () => {
    // AA KK + Q 2 3 — no straight or flush possible; best hand = AA KK Q
    const r = rank(cards('Ac', 'Ad', 'Kc', 'Kd', 'Qh', '2c', '3d'));
    expect(r).toEqual(hr(HandCategory.TwoPair, 14, 13, 12));
  });

  it('wheel straight selected from 7 cards', () => {
    // A 2 3 4 5 K Q → wheel straight (5-high) beats high-card alternatives
    const r = rank(cards('Ac', '2d', '3h', '4s', '5c', 'Kd', 'Qh'));
    expect(r.category).toBe(HandCategory.Straight);
    expect(r.tiebreaks[0]).toBe(5);
  });

  it('best flush selected when 6 suited cards present', () => {
    // 6 diamonds: A K Q J 9 2 — no straight (missing T), best flush is A K Q J 9
    const r = rank(cards('Ad', 'Kd', 'Qd', 'Jd', '9d', '2d', '3c'));
    expect(r).toEqual(hr(HandCategory.Flush, 14, 13, 12, 11, 9));
  });

  it('board plays — both players share a better 5-card hand', () => {
    // Royal flush on board; both hole cards irrelevant
    const board = cards('Ah', 'Kh', 'Qh', 'Jh', 'Th');
    const r1 = rank([...board, ...cards('2c', '3d')]);
    const r2 = rank([...board, ...cards('4c', '5d')]);
    expect(compareHandRank(r1, r2)).toBe(0);
    expect(r1.category).toBe(HandCategory.StraightFlush);
  });

  it('quads in 7 cards — best kicker selected', () => {
    // AAAA K Q → kicker is K not Q
    const r = rank(cards('Ac', 'Ad', 'Ah', 'As', 'Kd', 'Qc', '2h'));
    expect(r).toEqual(hr(HandCategory.FourOfAKind, 14, 13));
  });
});
