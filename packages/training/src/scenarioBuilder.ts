import type { PlayerId, Amount, GameState, PlayerState, Command, TransitionEvent } from '@count-the-outs/engine';
import { attempt, apply } from '@count-the-outs/engine';

export interface ScenarioSpec {
  id?: string;
  seatOrder: PlayerId[];
  buttonSeat: PlayerId;
  bigBlind: Amount;
  stacks: Map<PlayerId, Amount>;
  steps: ScenarioStep[];
}

export type ScenarioStep = Command | TransitionEvent;

const COMMAND_KINDS: ReadonlySet<string> = new Set(['Check', 'Fold', 'Call', 'RaiseTo', 'PostBlind']);

function isCommand(step: ScenarioStep): step is Command {
  return COMMAND_KINDS.has(step.kind);
}

/** invariants.md §10 — no alternative entry point; spec is executable history */
export function buildScenario(spec: ScenarioSpec): GameState {
  let state: GameState = {
    id: spec.id ?? 'drill',
    variant: 'nlhe',
    street: 'preflop',
    seatOrder: [...spec.seatOrder],
    buttonSeat: spec.buttonSeat,
    bigBlind: spec.bigBlind,
    currentBetLevel: 0,
    lastFullBetLevel: 0,
    lastFullRaiseIncrement: spec.bigBlind,
    players: spec.seatOrder.map((id, seat): PlayerState => ({
      id,
      seat,
      stack: spec.stacks.get(id) ?? 0,
      committedThisStreet: 0,
      folded: false,
      holeCards: null,
      seen: -1,
    })),
    board: [],
    history: [],
  };

  for (const step of spec.steps) {
    if (isCommand(step)) {
      const result = attempt(state, step);
      if (!result.ok) throw new Error(`ScenarioBuilder: illegal command ${step.kind}: ${result.error}`);
      for (const ev of result.events) {
        state = apply(state, ev);
      }
    } else {
      state = apply(state, step);
    }
  }

  return state;
}
