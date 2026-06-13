import type { GameState, PlayerId, Command } from '@count-the-outs/engine';
import { legalActions, totalCommitments } from '@count-the-outs/engine';
import type { AnalysisContext } from '@count-the-outs/math';
import { compute, comboKey } from '@count-the-outs/math';
import type { RangeRegistry } from './ranges/index.js';
import { PREFLOP_RANGES } from './ranges/index.js';

export interface Verdict {
  correct: boolean;
  score: number;
  reference: unknown;
  explanation: string;
}

export interface EvaluationPolicy {
  evaluate(state: GameState, userAction: Command, ctx?: AnalysisContext): Verdict;
}

function totalPot(state: GameState): number {
  let pot = 0;
  for (const v of totalCommitments(state).values()) pot += v;
  return pot;
}

const NO_CALL_VERDICT: Verdict = {
  correct: true,
  score: 1,
  reference: null,
  explanation: 'No bet to evaluate; action accepted.',
};

const NO_CTX_VERDICT: Verdict = {
  correct: false,
  score: 0,
  reference: null,
  explanation: 'Policy requires AnalysisContext with opponent assumptions.',
};

// ── EquityPolicy ──────────────────────────────────────────────────────────────

/** invariants.md §13 — grades call/fold by comparing hero equity to pot-odds break-even */
export class EquityPolicy implements EvaluationPolicy {
  constructor(
    private readonly heroId: PlayerId,
    private readonly epsilon = 0.02,
  ) {}

  evaluate(state: GameState, userAction: Command, ctx?: AnalysisContext): Verdict {
    const callAmount = legalActions(state, this.heroId).callAmount;
    if (callAmount === 0 || (userAction.kind !== 'Call' && userAction.kind !== 'Fold')) {
      return NO_CALL_VERDICT;
    }
    if (!ctx) return NO_CTX_VERDICT;

    const pot = totalPot(state);
    const breakEven = callAmount / (pot + callAmount);
    const equityResult = compute(ctx);
    const heroEquity = equityResult.equity.get(this.heroId) ?? 0;
    const edgeOverBreakEven = heroEquity - breakEven;

    const isCall = userAction.kind === 'Call';
    // correctEdge > 0 means the chosen action aligns with the equity signal
    const correctEdge = isCall ? edgeOverBreakEven : -edgeOverBreakEven;
    const correct = correctEdge >= -this.epsilon;
    const regret = Math.max(0, -correctEdge);
    const score = Math.max(0, Math.min(1, 1 - regret / 0.5));

    const direction = edgeOverBreakEven >= 0 ? 'above' : 'below';
    const action = isCall ? 'Call' : 'Fold';
    const verdict = correct ? 'correct' : 'incorrect';
    return {
      correct,
      score,
      reference: { heroEquity, breakEven, method: equityResult.method },
      explanation:
        `Hero equity ${(heroEquity * 100).toFixed(1)}% is ${direction} ` +
        `break-even ${(breakEven * 100).toFixed(1)}%. ${action} is ${verdict}.`,
    };
  }
}

// ── RangePolicy ───────────────────────────────────────────────────────────────

/** invariants.md §13/§15 — grades actions against a curated reference range */
export class RangePolicy implements EvaluationPolicy {
  constructor(
    private readonly heroId: PlayerId,
    private readonly spot: string,
    private readonly referenceAction: 'raise' | 'call',
    private readonly registry: RangeRegistry = PREFLOP_RANGES,
  ) {}

  evaluate(state: GameState, userAction: Command): Verdict {
    const entry = this.registry.get(this.spot);
    if (!entry) {
      return { correct: false, score: 0, reference: null, explanation: `Unknown spot: ${this.spot}` };
    }

    const hero = state.players.find(p => p.id === this.heroId);
    if (!hero?.holeCards) {
      return { correct: false, score: 0, reference: null, explanation: 'Hero hole cards not assigned.' };
    }

    const refKind = this.referenceAction === 'raise' ? 'RaiseTo' : 'Call';
    const isRatedAction = userAction.kind === refKind || userAction.kind === 'Fold';
    if (!isRatedAction) return NO_CALL_VERDICT;

    const [a, b] = hero.holeCards.cards;
    const key = comboKey(a, b);
    const weight = entry.range.get(key) ?? 0;
    const inRange = weight > 0;

    const correct = inRange ? userAction.kind === refKind : userAction.kind === 'Fold';
    const score = correct ? 1 : 0;

    const verb = inRange ? 'is' : 'is not';
    const actionVerdict = correct ? 'correct' : 'incorrect';
    return {
      correct,
      score,
      reference: { spot: this.spot, inRange, weight, source: entry.source, confidence: entry.confidence },
      explanation: `${key} ${verb} in ${this.spot} (weight ${weight.toFixed(2)}). ${userAction.kind} is ${actionVerdict}.`,
    };
  }
}

// ── EVPolicy ──────────────────────────────────────────────────────────────────

/** invariants.md §13 — grades actions by EV regret: correct when regret ≤ epsilon */
export class EVPolicy implements EvaluationPolicy {
  constructor(
    private readonly heroId: PlayerId,
    private readonly epsilon = 0,
    private readonly scale: 'pot' | number = 'pot',
  ) {}

  evaluate(state: GameState, userAction: Command, ctx?: AnalysisContext): Verdict {
    const callAmount = legalActions(state, this.heroId).callAmount;
    if (callAmount === 0 || (userAction.kind !== 'Call' && userAction.kind !== 'Fold')) {
      return NO_CALL_VERDICT;
    }
    if (!ctx) return NO_CTX_VERDICT;

    const pot = totalPot(state);
    const equityResult = compute(ctx);
    const heroEquity = equityResult.equity.get(this.heroId) ?? 0;

    const evCall = heroEquity * (pot + callAmount) - callAmount;
    const evFold = 0;
    const evBest = Math.max(evCall, evFold);
    const evChosen = userAction.kind === 'Call' ? evCall : evFold;
    const regret = evBest - evChosen;

    const scaleVal = this.scale === 'pot' ? pot : this.scale;
    const score = Math.max(0, Math.min(1, 1 - regret / (scaleVal || 1)));
    const correct = regret <= this.epsilon;

    const action = userAction.kind === 'Call' ? 'Call' : 'Fold';
    const verdict = correct ? 'correct' : 'incorrect';
    return {
      correct,
      score,
      reference: { heroEquity, evCall, evFold, evBest, regret, method: equityResult.method },
      explanation:
        `EV(call)=${evCall.toFixed(2)}, EV(fold)=0, regret=${regret.toFixed(2)}. ` +
        `${action} is ${verdict}.`,
    };
  }
}
