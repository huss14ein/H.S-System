import { describe, it, expect } from 'vitest';
import {
  sortByNewestFirst,
  comparePlannedTradesNewestFirst,
} from '../utils/sortRecency';
import type { PlannedTrade } from '../types';

describe('sortByNewestFirst', () => {
  it('orders dated rows newest first', () => {
    const rows = [
      { id: 'a', date: '2026-01-01' },
      { id: 'b', date: '2026-03-15' },
      { id: 'c', date: '2026-02-10' },
    ];
    expect(sortByNewestFirst(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('prefers created_at when date is missing', () => {
    const rows = [
      { created_at: '2026-01-01T00:00:00Z' },
      { created_at: '2026-06-01T00:00:00Z' },
    ];
    expect(sortByNewestFirst(rows)[0].created_at).toContain('2026-06');
  });
});

describe('comparePlannedTradesNewestFirst', () => {
  const base = (over: Partial<PlannedTrade>): PlannedTrade => ({
    id: '1',
    symbol: 'AAPL',
    name: 'Apple',
    tradeType: 'buy',
    conditionType: 'price',
    targetValue: 100,
    priority: 'Medium',
    status: 'Planned',
    ...over,
  });

  it('puts executed plans after active plans', () => {
    const active = base({ id: 'a', status: 'Planned' });
    const done = base({ id: 'b', status: 'Executed' });
    expect(comparePlannedTradesNewestFirst(active, done)).toBeLessThan(0);
  });

  it('sorts date plans by later target first', () => {
    const later = base({ conditionType: 'date', targetValue: new Date('2026-12-01').getTime() });
    const sooner = base({ conditionType: 'date', targetValue: new Date('2026-06-01').getTime() });
    expect(comparePlannedTradesNewestFirst(later, sooner)).toBeLessThan(0);
  });
});
