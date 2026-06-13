import { parseRange } from '@count-the-outs/math';
import type { RangeEntry } from './index.js';

// invariants.md §15 — self-authored heuristic ranges, no solver/licensed data
export const PREFLOP_RANGE_ENTRIES: RangeEntry[] = [
  {
    spot: 'BTN_open',
    range: parseRange('22+, A2s+, A2o+, K4s+, K9o+, Q7s+, Q9o+, J7s+, J9o+, T8s+, T9o, 98s, 87s, 76s, 65s'),
    source: 'heuristic',
    confidence: 'medium — ~45% open, standard 6-max estimate',
  },
  {
    spot: 'CO_open',
    range: parseRange('22+, A2s+, A7o+, A5o-A2o, K8s+, KTo+, Q9s+, QJo+, J9s+, JTo, T9s, 98s'),
    source: 'heuristic',
    confidence: 'medium — ~30% open, standard 6-max estimate',
  },
  {
    spot: 'HJ_open',
    range: parseRange('55+, A2s+, ATo+, A5o-A2o, K9s+, KJo+, Q9s+, QJo+, JTs, JTo, T9s'),
    source: 'heuristic',
    confidence: 'medium — ~24% open, standard 6-max estimate',
  },
  {
    spot: 'UTG_open',
    range: parseRange('77+, A9s+, ATo+, KTs+, KJo+, QTs+, QJo+, JTs'),
    source: 'heuristic',
    confidence: 'medium — ~18% open, standard 6-max estimate',
  },
  {
    spot: 'SB_open',
    range: parseRange('22+, A2s+, A2o+, K5s+, K8o+, Q7s+, Q9o+, J7s+, J9o+, T8s+, T9o, 98s, 87s, 76s, 65s'),
    source: 'heuristic',
    confidence: 'medium — ~40% vs single BB, standard estimate',
  },
  {
    spot: 'BB_defend_vs_BTN',
    range: parseRange('22+, A2s+, A2o+, K6s+, K8o+, Q7s+, Q9o+, J7s+, J9o+, T7s+, T9o, 97s+, 87s, 86s, 76s, 65s, 54s'),
    source: 'heuristic',
    confidence: 'medium — ~50% call vs BTN open, standard estimate',
  },
  {
    spot: 'BB_defend_vs_CO',
    range: parseRange('22+, A2s+, A5o+, A3o-A2o, K7s+, KTo+, Q8s+, QJo+, J8s+, JTo, T8s+, T9o, 98s, 87s, 76s'),
    source: 'heuristic',
    confidence: 'medium — ~42% call vs CO open, standard estimate',
  },
  {
    spot: 'BB_defend_vs_SB',
    range: parseRange('22+, A2s+, A2o+, K5s+, K9o+, Q7s+, Q9o+, J8s+, J9o+, T8s+, T9o, 98s, 87s, 76s, 65s'),
    source: 'heuristic',
    confidence: 'medium — ~45% call vs SB steal, standard estimate',
  },
  {
    spot: 'BTN_3bet_vs_CO',
    range: parseRange('JJ+, AKs, AQs, AKo, A5s-A2s'),
    source: 'heuristic',
    confidence: 'medium — polarized 3bet: value + nut-low bluffs, standard estimate',
  },
  {
    spot: 'SB_3bet_vs_BTN',
    range: parseRange('JJ+, AKs, AQs, AKo, A4s-A2s'),
    source: 'heuristic',
    confidence: 'medium — polarized 3bet: value + nut-low bluffs, standard estimate',
  },
  {
    spot: 'BB_3bet_vs_BTN',
    range: parseRange('QQ+, AKs, AKo, A5s-A2s, KQs:0.5'),
    source: 'heuristic',
    confidence: 'medium — polarized 3bet vs BTN; KQs mixed 50%, standard estimate',
  },
  {
    spot: 'BB_3bet_vs_CO',
    range: parseRange('JJ+, AKs, AKo, A5s-A3s'),
    source: 'heuristic',
    confidence: 'medium — polarized 3bet vs CO; tighter bluff range than vs BTN, standard estimate',
  },
];
