import type { GameState, PlayerState, PlayerId, Amount, Street } from './gameState.js';
import type { TransitionEvent, Command } from './transitions.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const p = state.players.find(p => p.id === id);
  if (!p) throw new Error(`Player not found: ${id}`);
  return p;
}

function nextSeat(seatOrder: PlayerId[], id: PlayerId): PlayerId {
  const idx = seatOrder.indexOf(id);
  if (idx === -1) throw new Error(`Player not in seatOrder: ${id}`);
  return seatOrder[(idx + 1) % seatOrder.length]!;
}

// ── predicates ────────────────────────────────────────────────────────────────

export function requiresAction(p: PlayerState): boolean {
  return !p.folded && p.stack > 0;
}

// invariants.md §4 — the load-bearing formula
export function needsToAct(state: GameState, p: PlayerState): boolean {
  if (!requiresAction(p)) return false;
  const chipDeficit = p.committedThisStreet < state.currentBetLevel;
  const reopened = p.seen < state.lastFullBetLevel;
  return chipDeficit || reopened;
}

export function bettingRoundComplete(state: GameState): boolean {
  return !state.players.some(p => needsToAct(state, p));
}

export function handTerminal(state: GameState): boolean {
  const eligible = state.players.filter(p => !p.folded);
  if (eligible.length <= 1) return true;
  return state.street === 'river' && bettingRoundComplete(state);
}

// ── actor derivation ──────────────────────────────────────────────────────────

// Scan history backwards for most recent ActionAccepted on this street.
// BoardCardsRevealed marks the street boundary; stop there.
function lastActionAcceptedThisStreet(history: TransitionEvent[]): PlayerId | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const ev = history[i]!;
    if (ev.kind === 'ActionAccepted') return ev.player;
    if (ev.kind === 'BoardCardsRevealed') return null;
  }
  return null;
}

function firstToAct(state: GameState): PlayerId {
  if (state.street === 'preflop') {
    // invariants.md §4: seatAfter(BB). Heads-up falls out automatically:
    // Button=SB, seatAfter(Button)=BB, seatAfter(BB)=Button.
    const sb = state.seatOrder.length === 2
      ? state.buttonSeat
      : nextSeat(state.seatOrder, state.buttonSeat);
    const bb = nextSeat(state.seatOrder, sb);
    return nextSeat(state.seatOrder, bb);
  }
  return nextSeat(state.seatOrder, state.buttonSeat);
}

export function currentActor(state: GameState): PlayerId | null {
  const lastActor = lastActionAcceptedThisStreet(state.history);
  const start = lastActor
    ? nextSeat(state.seatOrder, lastActor)
    : firstToAct(state);

  const n = state.seatOrder.length;
  const startIdx = state.seatOrder.indexOf(start);
  for (let offset = 0; offset < n; offset++) {
    const id = state.seatOrder[(startIdx + offset) % n]!;
    if (needsToAct(state, getPlayer(state, id))) return id;
  }
  return null;
}

// ── legal actions ─────────────────────────────────────────────────────────────

export interface LegalActions {
  canCheck: boolean;
  canFold: boolean;
  canCall: boolean;
  callAmount: Amount;
  canRaise: boolean;
  raiseMin: Amount;
  raiseMax: Amount;
}

export function legalActions(state: GameState, playerId: PlayerId): LegalActions {
  const p = getPlayer(state, playerId);
  const toCall = state.currentBetLevel - p.committedThisStreet;
  const maxTo = p.committedThisStreet + p.stack;
  const minFullTo = state.currentBetLevel + state.lastFullRaiseIncrement;

  const canRaise = maxTo > state.currentBetLevel;
  const raiseMin = minFullTo <= maxTo ? minFullTo : maxTo;

  return {
    canCheck: toCall === 0,
    canFold: true,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, p.stack),
    canRaise,
    raiseMin,
    raiseMax: maxTo,
  };
}

// ── attempt ───────────────────────────────────────────────────────────────────

export type AttemptResult =
  | { ok: true; events: TransitionEvent[] }
  | { ok: false; error: string };

function nextBlindPoster(state: GameState): PlayerId | null {
  const posted = state.history.filter(e => e.kind === 'BlindPosted').length;
  // Heads-up: SB = button. Multiway: SB = nextSeat(button).
  const sb = state.seatOrder.length === 2
    ? state.buttonSeat
    : nextSeat(state.seatOrder, state.buttonSeat);
  if (posted === 0) return sb;
  if (posted === 1) return nextSeat(state.seatOrder, sb);
  return null;
}

export function attempt(state: GameState, command: Command): AttemptResult {
  if (command.kind === 'PostBlind') {
    const poster = nextBlindPoster(state);
    if (!poster) return { ok: false, error: 'Blind phase complete' };
    const p = getPlayer(state, poster);
    const amount = Math.min(command.amount, p.stack);
    return { ok: true, events: [{ kind: 'BlindPosted', player: poster, amount }] };
  }

  const actor = currentActor(state);
  if (!actor) return { ok: false, error: 'No player needs to act' };
  const p = getPlayer(state, actor);

  switch (command.kind) {
    case 'Check': {
      const toCall = state.currentBetLevel - p.committedThisStreet;
      if (toCall !== 0) return { ok: false, error: 'Cannot check: bet to call' };
      return { ok: true, events: [{ kind: 'ActionAccepted', player: actor, command }] };
    }

    case 'Fold': {
      return { ok: true, events: [{ kind: 'ActionAccepted', player: actor, command }] };
    }

    case 'Call': {
      const toCall = state.currentBetLevel - p.committedThisStreet;
      if (toCall <= 0) return { ok: false, error: 'Nothing to call' };
      const amount = Math.min(toCall, p.stack);
      return {
        ok: true,
        events: [
          { kind: 'ActionAccepted', player: actor, command },
          { kind: 'ChipsCommitted', player: actor, amount },
        ],
      };
    }

    case 'RaiseTo': {
      const x = command.amount;
      const maxTo = p.committedThisStreet + p.stack;
      if (x <= state.currentBetLevel) return { ok: false, error: 'RaiseTo must exceed currentBetLevel' };
      if (x > maxTo) return { ok: false, error: 'RaiseTo exceeds stack' };
      const isFullRaise = x - state.currentBetLevel >= state.lastFullRaiseIncrement;
      if (!isFullRaise && x !== maxTo) return { ok: false, error: 'Sub-minimum raise only legal as all-in' };
      return {
        ok: true,
        events: [
          { kind: 'ActionAccepted', player: actor, command },
          { kind: 'ChipsCommitted', player: actor, amount: x - p.committedThisStreet },
        ],
      };
    }
  }
}

// ── apply ─────────────────────────────────────────────────────────────────────

export function apply(state: GameState, event: TransitionEvent): GameState {
  const history = [...state.history, event];

  switch (event.kind) {
    case 'BlindPosted': {
      const players = state.players.map(p =>
        p.id !== event.player ? p
          : { ...p, stack: p.stack - event.amount, committedThisStreet: p.committedThisStreet + event.amount }
      );
      let { currentBetLevel, lastFullBetLevel, lastFullRaiseIncrement } = state;
      if (event.amount > currentBetLevel) {
        currentBetLevel = event.amount;
        lastFullBetLevel = event.amount;
        lastFullRaiseIncrement = event.amount;
      }
      return { ...state, players, currentBetLevel, lastFullBetLevel, lastFullRaiseIncrement, history };
    }

    case 'HoleCardsAssigned': {
      const players = state.players.map(p =>
        p.id !== event.player ? p : { ...p, holeCards: { cards: event.cards } }
      );
      return { ...state, players, history };
    }

    case 'ActionAccepted': {
      const cmd = event.command;
      let { currentBetLevel, lastFullBetLevel, lastFullRaiseIncrement } = state;

      if (cmd.kind === 'RaiseTo') {
        const isFullRaise = cmd.amount - currentBetLevel >= lastFullRaiseIncrement;
        if (isFullRaise) {
          lastFullRaiseIncrement = cmd.amount - currentBetLevel;
          lastFullBetLevel = cmd.amount;
        }
        currentBetLevel = cmd.amount;
      }

      const players = state.players.map(p => {
        if (p.id !== event.player) return p;
        if (cmd.kind === 'Fold') return { ...p, folded: true, seen: lastFullBetLevel };
        return { ...p, seen: lastFullBetLevel };
      });

      return { ...state, players, currentBetLevel, lastFullBetLevel, lastFullRaiseIncrement, history };
    }

    case 'ChipsCommitted': {
      const players = state.players.map(p =>
        p.id !== event.player ? p
          : { ...p, stack: p.stack - event.amount, committedThisStreet: p.committedThisStreet + event.amount }
      );
      return { ...state, players, history };
    }

    case 'BoardCardsRevealed': {
      // seen=-1 sentinel: "hasn't acted this street yet" — ensures -1 < lastFullBetLevel(0) is true
      const players = state.players.map(p => ({ ...p, committedThisStreet: 0, seen: -1 }));
      return {
        ...state,
        street: event.street,
        board: [...state.board, ...event.cards],
        players,
        currentBetLevel: 0,
        lastFullBetLevel: 0,
        lastFullRaiseIncrement: state.bigBlind,
        history,
      };
    }

    case 'CardsShown':
    case 'CardsMucked':
      return { ...state, history };
  }
}

// ── deriveNext ────────────────────────────────────────────────────────────────

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
const REVEAL_COUNTS: Record<Street, number> = { preflop: 0, flop: 3, turn: 1, river: 1 };

export type NeedsInput =
  | { kind: 'Reveal'; street: Street; count: number }
  | { kind: 'ActionRequired'; playerId: PlayerId };

export type DeriveResult =
  | { kind: 'done' }
  | { kind: 'input'; request: NeedsInput };

export function deriveNext(state: GameState): DeriveResult {
  if (handTerminal(state)) return { kind: 'done' };

  if (bettingRoundComplete(state)) {
    const nextStreetIdx = STREETS.indexOf(state.street) + 1;
    const nextStreet = STREETS[nextStreetIdx] as Street;
    return { kind: 'input', request: { kind: 'Reveal', street: nextStreet, count: REVEAL_COUNTS[nextStreet] } };
  }

  const actor = currentActor(state);
  if (!actor) return { kind: 'done' };
  return { kind: 'input', request: { kind: 'ActionRequired', playerId: actor } };
}
