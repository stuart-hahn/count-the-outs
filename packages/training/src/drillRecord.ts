import type { Street, Command } from '@count-the-outs/engine';
import type { ScenarioSpec } from './scenarioBuilder.js';
import type { Verdict } from './policies.js';

// ── Core tag taxonomy ─────────────────────────────────────────────────────────

export type Position = 'BTN' | 'CO' | 'HJ' | 'UTG' | 'SB' | 'BB';
export type StackDepthBucket = 'short' | 'medium' | 'deep';
export type PotTypeBucket = 'single-raised' | 'multi-raised' | 'limped' | 'all-in';
export type ActionContext = 'open' | 'facing-raise' | 'facing-3bet' | 'facing-bet' | 'facing-check';

export interface CoreTags {
  position?: Position;
  street?: Street;
  actionContext?: ActionContext;
  stackDepth?: StackDepthBucket;
  potType?: PotTypeBucket;
}

export interface DrillTags {
  core: CoreTags;
  aux: Record<string, string>;
}

// ── DrillRecord ───────────────────────────────────────────────────────────────

export interface DrillRecord {
  scenarioSpec: ScenarioSpec;
  userAction: Command;
  verdict: Verdict;
  tags: DrillTags;
  timestamp: number;
}

// ── Append-only log ───────────────────────────────────────────────────────────

export class DrillLog {
  private readonly _records: DrillRecord[] = [];

  append(record: DrillRecord): void {
    this._records.push(record);
  }

  all(): readonly DrillRecord[] {
    return [...this._records];
  }
}

// ── Pure query functions ──────────────────────────────────────────────────────

/** Average score over records. Returns 0 for empty input. */
export function accuracy(records: readonly DrillRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((sum, r) => sum + r.verdict.score, 0) / records.length;
}

/** Filter records by core tag values. Only specified keys are matched. */
export function filterByCore(
  records: readonly DrillRecord[],
  filter: Partial<CoreTags>,
): DrillRecord[] {
  return records.filter(r => {
    for (const key of Object.keys(filter) as (keyof CoreTags)[]) {
      if (filter[key] !== undefined && r.tags.core[key] !== filter[key]) return false;
    }
    return true;
  });
}

/** Group records by a core tag key and compute accuracy per group. */
export function leaks(
  records: readonly DrillRecord[],
  groupBy: keyof CoreTags,
): Map<string, number> {
  const groups = new Map<string, DrillRecord[]>();
  for (const r of records) {
    const key = String(r.tags.core[groupBy] ?? 'unknown');
    const g = groups.get(key);
    if (g) {
      g.push(r);
    } else {
      groups.set(key, [r]);
    }
  }
  const result = new Map<string, number>();
  for (const [k, g] of groups) {
    result.set(k, accuracy(g));
  }
  return result;
}

/** Sliding-window average score over records ordered by timestamp. */
export function trend(records: readonly DrillRecord[], windowSize: number): number[] {
  if (records.length === 0 || windowSize <= 0) return [];
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);
  const result: number[] = [];
  for (let i = 0; i <= sorted.length - windowSize; i++) {
    result.push(accuracy(sorted.slice(i, i + windowSize)));
  }
  return result;
}
