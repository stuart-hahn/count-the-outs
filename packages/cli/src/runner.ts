import * as readline from 'node:readline';
import type { Card, Command } from '@count-the-outs/engine';
import { freshDeck, shuffleDeck, legalActions } from '@count-the-outs/engine';
import type { ScenarioSpec, Position } from '@count-the-outs/training';
import { buildScenario, RangePolicy, DrillLog, accuracy } from '@count-the-outs/training';
import { SPOTS } from './spots.js';

const RANK_CHAR: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
};

function formatHand(c1: Card, c2: Card): string {
  const [high, low] = c1.rank >= c2.rank ? [c1, c2] : [c2, c1];
  const r1 = RANK_CHAR[high.rank] ?? '?';
  const r2 = RANK_CHAR[low.rank] ?? '?';
  if (high.rank === low.rank) return `${r1}${r2}`;
  return `${r1}${r2}${high.suit === low.suit ? 's' : 'o'}`;
}

const STACKS = new Map<string, number>([
  ['UTG', 10000], ['HJ', 10000], ['CO', 10000],
  ['BTN', 10000], ['SB', 10000], ['BB', 10000],
]);

const SEAT_ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// ── input reader ──────────────────────────────────────────────────────────────

// Uses rl.on('line') + a waiter queue so buffered lines from a pipe are
// delivered correctly even after readline emits 'close'.
function createInputReader() {
  const buffered: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  let closed = false;

  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', line => {
    if (waiters.length > 0) {
      waiters.shift()!(line);
    } else {
      buffered.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    for (const resolve of waiters) resolve(null);
    waiters.length = 0;
  });

  return {
    ask(prompt: string): Promise<string | null> {
      process.stdout.write(prompt);
      return new Promise(resolve => {
        if (buffered.length > 0) {
          const line = buffered.shift()!;
          if (!process.stdin.isTTY) process.stdout.write('\n');
          resolve(line);
        } else if (closed) {
          resolve(null);
        } else {
          waiters.push(answer => {
            if (answer !== null && !process.stdin.isTTY) process.stdout.write('\n');
            resolve(answer);
          });
        }
      });
    },
    onSIGINT(handler: () => void) {
      rl.on('SIGINT', handler);
    },
    close() {
      rl.close();
    },
  };
}

// ── session ───────────────────────────────────────────────────────────────────

export async function runSession(count: number, spotFilter: string | null): Promise<void> {
  const log = new DrillLog();
  const activeSpots = spotFilter ? SPOTS.filter(s => s.spot === spotFilter) : SPOTS;
  const reader = createInputReader();

  const printSummary = () => {
    const records = log.all();
    if (records.length === 0) {
      console.log('\nNo drills completed.');
      return;
    }
    const correct = records.filter(r => r.verdict.correct).length;
    const pct = (accuracy(records) * 100).toFixed(1);
    console.log(`\nSession: ${correct}/${records.length} correct (${pct}%)`);
  };

  reader.onSIGINT(() => {
    reader.close();
    printSummary();
    process.exit(0);
  });

  for (let i = 0; i < count; i++) {
    const spot = activeSpots[Math.floor(Math.random() * activeSpots.length)]!;

    const deck = shuffleDeck(freshDeck());
    const heroCards: [Card, Card] = [deck[0]!, deck[1]!];

    const spec: ScenarioSpec = {
      id: `drill-${i}`,
      seatOrder: SEAT_ORDER,
      buttonSeat: 'BTN',
      bigBlind: 100,
      stacks: STACKS,
      steps: spot.buildSteps(heroCards),
    };

    const state = buildScenario(spec);
    const hand = formatHand(heroCards[0], heroCards[1]);

    console.log(`\n[${i + 1}/${count}] ${spot.label}`);
    console.log(`Hand: ${hand}`);

    const hint = spot.referenceAction === 'raise' ? '[r]aise / [f]old: ' : '[c]all / [f]old: ';
    const validKeys = spot.referenceAction === 'raise'
      ? new Set(['r', 'raise', 'f', 'fold'])
      : new Set(['c', 'call', 'f', 'fold']);

    let input = '';
    let prefix = '';
    for (;;) {
      const answer = await reader.ask(prefix + hint);
      if (answer === null) {
        reader.close();
        printSummary();
        return;
      }
      const raw = answer.trim().toLowerCase();
      if (validKeys.has(raw)) {
        input = raw;
        break;
      }
      prefix = '? ';
    }

    let command: Command;
    if (input === 'f' || input === 'fold') {
      command = { kind: 'Fold' };
    } else if (input === 'r' || input === 'raise') {
      const { raiseMin } = legalActions(state, spot.heroId);
      command = { kind: 'RaiseTo', amount: raiseMin };
    } else {
      command = { kind: 'Call' };
    }

    const policy = new RangePolicy(spot.heroId, spot.spot, spot.referenceAction);
    const verdict = policy.evaluate(state, command);

    console.log(`${verdict.correct ? '✓' : '✗'} ${verdict.explanation}`);

    log.append({
      scenarioSpec: spec,
      userAction: command,
      verdict,
      tags: {
        core: {
          position: spot.heroId as Position,
          street: 'preflop',
          actionContext: spot.actionContext,
          stackDepth: 'deep',
          potType: spot.potType,
        },
        aux: { spot: spot.spot },
      },
      timestamp: Date.now(),
    });
  }

  reader.close();
  printSummary();
}
