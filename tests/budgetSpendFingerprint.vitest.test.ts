import { describe, expect, it } from 'vitest';
import { buildBudgetSpendFingerprint } from '../services/budgetSpendFingerprint';

describe('buildBudgetSpendFingerprint', () => {
  const windows = {
    rangeStart: '2026-05-01',
    rangeEnd: '2026-05-31',
    previousRangeStart: '2026-04-01',
    previousRangeEnd: '2026-04-30',
    ytdStart: '2026-01-01',
    ytdEnd: '2026-05-31',
  };

  it('is stable for the same spend inputs and windows', () => {
    const txs = [
      { date: '2026-05-10', amount: -100, type: 'expense', status: 'Approved' },
      { date: '2026-05-12', amount: -50.5, type: 'expense', status: 'Approved' },
    ];
    const a = buildBudgetSpendFingerprint(txs, windows, { budgetCount: 3 });
    const b = buildBudgetSpendFingerprint([...txs], windows, { budgetCount: 3 });
    expect(a).toBe(b);
  });

  it('changes when an approved expense is added', () => {
    const base = [{ date: '2026-05-10', amount: -100, type: 'expense', status: 'Approved' }];
    const withExtra = [
      ...base,
      { date: '2026-05-15', amount: -20, type: 'expense', status: 'Approved' },
    ];
    expect(buildBudgetSpendFingerprint(base, windows)).not.toBe(buildBudgetSpendFingerprint(withExtra, windows));
  });

  it('ignores pending expenses and non-expense rows', () => {
    const txs = [
      { date: '2026-05-10', amount: -500, type: 'expense', status: 'Pending' },
      { date: '2026-05-11', amount: 2000, type: 'income', status: 'Approved' },
    ];
    expect(buildBudgetSpendFingerprint(txs, windows)).toBe(buildBudgetSpendFingerprint([], windows));
  });
});
