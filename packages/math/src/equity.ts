import type { Card, PlayerId, GameState } from '@count-the-outs/engine';
import { freshDeck } from '@count-the-outs/engine';
import { rank as rankHand, compareHandRank } from './handEvaluator.js';
import { effectiveRange, cardStr, keyToCombo } from './range.js';
import type { Range } from './range.js';

export interface AnalysisContext {
  state: GameState;
  observer: PlayerId;
  assumptions: Map<PlayerId, Range>;
  objective?: unknown;
  configuration?: { exactThreshold?: number; monteCarloSamples?: number };
}

export type EquityMethod =
  | { type: 'Exact' }
  | { type: 'MonteCarlo'; samples: number; stderr: number };

export interface EquityResult {
  equity: Map<PlayerId, number>;
  method: EquityMethod;
}

const DEFAULT_EXACT_THRESHOLD = 200_000;
const DEFAULT_MC_SAMPLES = 10_000;

function choose(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}

function combinations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map(c => [first!, ...c]),
    ...combinations(rest, k),
  ];
}

function sampleN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = 0; i < n && i < copy.length; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

function weightedSample(entries: readonly [string, number][]): string {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1]![0];
}

// ── exact enumeration ─────────────────────────────────────────────────────────

function exactEquity(
  players: PlayerId[],
  effRanges: Map<PlayerId, Map<string, number>>,
  board: readonly Card[],
  unseenDeck: readonly Card[],
  numBoardNeeded: number,
): Map<PlayerId, number> {
  const scores = new Map<PlayerId, number>(players.map(p => [p, 0]));
  let totalWeight = 0;

  // Pre-compute runouts from full unseen deck; filter per-combo-assignment in the loop.
  const allRunouts = combinations([...unseenDeck], numBoardNeeded);

  function recurse(
    idx: number,
    assignment: [Card, Card][],
    usedKeys: Set<string>,
    jointWeight: number,
  ): void {
    if (idx === players.length) {
      for (const runout of allRunouts) {
        if (runout.some(c => usedKeys.has(cardStr(c)))) continue;
        const fullBoard = [...board, ...runout];
        const handRanks = assignment.map(combo => rankHand([...combo, ...fullBoard]));

        let best = handRanks[0]!;
        for (let i = 1; i < handRanks.length; i++) {
          if (compareHandRank(handRanks[i]!, best) > 0) best = handRanks[i]!;
        }

        let numWinners = 0;
        for (const hr of handRanks) if (compareHandRank(hr, best) === 0) numWinners++;

        const share = jointWeight / numWinners;
        for (let i = 0; i < players.length; i++) {
          if (compareHandRank(handRanks[i]!, best) === 0) {
            scores.set(players[i]!, scores.get(players[i]!)! + share);
          }
        }
        totalWeight += jointWeight;
      }
      return;
    }

    const p = players[idx]!;
    const range = effRanges.get(p)!;
    for (const [key, w] of range) {
      const [a, b] = keyToCombo(key);
      const ak = cardStr(a), bk = cardStr(b);
      if (usedKeys.has(ak) || usedKeys.has(bk)) continue;
      usedKeys.add(ak); usedKeys.add(bk);
      assignment.push([a, b]);
      recurse(idx + 1, assignment, usedKeys, jointWeight * w);
      assignment.pop();
      usedKeys.delete(ak); usedKeys.delete(bk);
    }
  }

  recurse(0, [], new Set(board.map(cardStr)), 1);

  if (totalWeight === 0) return new Map(players.map(p => [p, 1 / players.length]));
  return new Map(players.map(p => [p, scores.get(p)! / totalWeight]));
}

// ── monte carlo ───────────────────────────────────────────────────────────────

function mcEquity(
  players: PlayerId[],
  effRanges: Map<PlayerId, Map<string, number>>,
  board: readonly Card[],
  unseenDeck: readonly Card[],
  numBoardNeeded: number,
  samples: number,
): { equity: Map<PlayerId, number>; stderr: number } {
  const scores = new Map<PlayerId, number>(players.map(p => [p, 0]));
  let validSamples = 0;

  for (let i = 0; i < samples; i++) {
    const usedKeys = new Set<string>(board.map(cardStr));
    const assignment: [Card, Card][] = [];
    let valid = true;

    for (const p of players) {
      const range = effRanges.get(p)!;
      const validEntries = [...range.entries()].filter(([key]) => {
        const [a, b] = keyToCombo(key);
        return !usedKeys.has(cardStr(a)) && !usedKeys.has(cardStr(b));
      });
      if (validEntries.length === 0) { valid = false; break; }
      const key = weightedSample(validEntries);
      const [a, b] = keyToCombo(key);
      assignment.push([a, b]);
      usedKeys.add(cardStr(a));
      usedKeys.add(cardStr(b));
    }

    if (!valid) continue;

    const remaining = unseenDeck.filter(c => !usedKeys.has(cardStr(c)));
    const runout = sampleN(remaining, numBoardNeeded);
    const fullBoard = [...board, ...runout];

    const handRanks = assignment.map(combo => rankHand([...combo, ...fullBoard]));
    let best = handRanks[0]!;
    for (let j = 1; j < handRanks.length; j++) {
      if (compareHandRank(handRanks[j]!, best) > 0) best = handRanks[j]!;
    }

    let numWinners = 0;
    for (const hr of handRanks) if (compareHandRank(hr, best) === 0) numWinners++;
    const share = 1 / numWinners;
    for (let j = 0; j < players.length; j++) {
      if (compareHandRank(handRanks[j]!, best) === 0) {
        scores.set(players[j]!, scores.get(players[j]!)! + share);
      }
    }
    validSamples++;
  }

  if (validSamples === 0) {
    return { equity: new Map(players.map(p => [p, 1 / players.length])), stderr: 0.5 };
  }

  const equity = new Map(players.map(p => [p, scores.get(p)! / validSamples]));
  let maxStderr = 0;
  for (const [, e] of equity) {
    const se = Math.sqrt(Math.max(0, e * (1 - e)) / validSamples);
    if (se > maxStderr) maxStderr = se;
  }
  return { equity, stderr: maxStderr };
}

// ── public API ────────────────────────────────────────────────────────────────

/** invariants.md §11 — equity = P(win) + 0.5×P(tie); exact when product ≤ threshold, else Monte Carlo */
export function compute(ctx: AnalysisContext): EquityResult {
  const { state, assumptions, configuration } = ctx;
  const threshold = configuration?.exactThreshold ?? DEFAULT_EXACT_THRESHOLD;
  const mcSamples = configuration?.monteCarloSamples ?? DEFAULT_MC_SAMPLES;

  const players = [...assumptions.keys()];
  const board = state.board;
  const numBoardNeeded = Math.max(0, 5 - board.length);

  const deadCards = [...board];
  const effRanges = new Map<PlayerId, Map<string, number>>();
  for (const [p, range] of assumptions) {
    effRanges.set(p, effectiveRange(range, deadCards));
  }

  const unseenDeck = freshDeck().filter(
    c => !deadCards.some(d => d.rank === c.rank && d.suit === c.suit),
  );

  let product = choose(unseenDeck.length, numBoardNeeded);
  for (const [, er] of effRanges) product *= er.size;

  if (product <= threshold) {
    return {
      equity: exactEquity(players, effRanges, board, unseenDeck, numBoardNeeded),
      method: { type: 'Exact' },
    };
  }

  const { equity, stderr } = mcEquity(players, effRanges, board, unseenDeck, numBoardNeeded, mcSamples);
  return { equity, method: { type: 'MonteCarlo', samples: mcSamples, stderr } };
}
