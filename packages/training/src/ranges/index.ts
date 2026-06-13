import type { Range } from '@count-the-outs/math';
import { PREFLOP_RANGE_ENTRIES } from './preflop.js';

export interface RangeEntry {
  spot: string;
  range: Range;
  source: 'heuristic' | 'solver-derived' | 'author-estimate';
  confidence: string;
}

export type RangeRegistry = ReadonlyMap<string, RangeEntry>;

export const PREFLOP_RANGES: RangeRegistry = new Map(
  PREFLOP_RANGE_ENTRIES.map(e => [e.spot, e]),
);
