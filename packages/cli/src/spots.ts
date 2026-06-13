import type { Card } from '@count-the-outs/engine';
import type { ScenarioStep, ActionContext, PotTypeBucket } from '@count-the-outs/training';

export interface SpotConfig {
  spot: string;
  label: string;
  heroId: string;
  referenceAction: 'raise' | 'call';
  actionContext: ActionContext;
  potType: PotTypeBucket;
  buildSteps: (heroCards: [Card, Card]) => ScenarioStep[];
}

const OPEN_SIZE = 250;

function posts(): ScenarioStep[] {
  return [
    { kind: 'PostBlind', amount: 50 },
    { kind: 'PostBlind', amount: 100 },
  ];
}

function deal(player: string, cards: [Card, Card]): ScenarioStep {
  return { kind: 'HoleCardsAssigned', player, cards };
}

function folds(n: number): ScenarioStep[] {
  return Array.from({ length: n }, (): ScenarioStep => ({ kind: 'Fold' }));
}

function openRaise(): ScenarioStep {
  return { kind: 'RaiseTo', amount: OPEN_SIZE };
}

export const SPOTS: SpotConfig[] = [
  {
    spot: 'UTG_open',
    label: 'UTG open',
    heroId: 'UTG',
    referenceAction: 'raise',
    actionContext: 'open',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('UTG', cards)],
  },
  {
    spot: 'HJ_open',
    label: 'HJ open',
    heroId: 'HJ',
    referenceAction: 'raise',
    actionContext: 'open',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('HJ', cards), ...folds(1)],
  },
  {
    spot: 'CO_open',
    label: 'CO open',
    heroId: 'CO',
    referenceAction: 'raise',
    actionContext: 'open',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('CO', cards), ...folds(2)],
  },
  {
    spot: 'BTN_open',
    label: 'BTN open',
    heroId: 'BTN',
    referenceAction: 'raise',
    actionContext: 'open',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BTN', cards), ...folds(3)],
  },
  {
    spot: 'SB_open',
    label: 'SB open',
    heroId: 'SB',
    referenceAction: 'raise',
    actionContext: 'open',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('SB', cards), ...folds(4)],
  },
  {
    spot: 'BB_defend_vs_BTN',
    label: 'BB defend vs BTN',
    heroId: 'BB',
    referenceAction: 'call',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BB', cards), ...folds(3), openRaise(), ...folds(1)],
  },
  {
    spot: 'BB_defend_vs_CO',
    label: 'BB defend vs CO',
    heroId: 'BB',
    referenceAction: 'call',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BB', cards), ...folds(2), openRaise(), ...folds(2)],
  },
  {
    spot: 'BB_defend_vs_SB',
    label: 'BB defend vs SB',
    heroId: 'BB',
    referenceAction: 'call',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BB', cards), ...folds(4), openRaise()],
  },
  {
    spot: 'BTN_3bet_vs_CO',
    label: 'BTN 3bet vs CO',
    heroId: 'BTN',
    referenceAction: 'raise',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BTN', cards), ...folds(2), openRaise()],
  },
  {
    spot: 'SB_3bet_vs_BTN',
    label: 'SB 3bet vs BTN',
    heroId: 'SB',
    referenceAction: 'raise',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('SB', cards), ...folds(3), openRaise()],
  },
  {
    spot: 'BB_3bet_vs_BTN',
    label: 'BB 3bet vs BTN',
    heroId: 'BB',
    referenceAction: 'raise',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BB', cards), ...folds(3), openRaise(), ...folds(1)],
  },
  {
    spot: 'BB_3bet_vs_CO',
    label: 'BB 3bet vs CO',
    heroId: 'BB',
    referenceAction: 'raise',
    actionContext: 'facing-raise',
    potType: 'single-raised',
    buildSteps: cards => [...posts(), deal('BB', cards), ...folds(2), openRaise(), ...folds(2)],
  },
];
