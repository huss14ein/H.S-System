import { describe, expect, it } from 'vitest';
import {
  buildAdvanceFromNextMonthNoteTag,
  computeNextMonthBorrowHeadroomSar,
  nextFinancialMonthKey,
  parseAdvanceFromNextMonthNote,
  summarizeFinalizedAdvanceTransfers,
} from '../services/budgetAdvanceFromNextMonth';
import type { Budget, BudgetRequest } from '../types';

describe('budgetAdvanceFromNextMonth', () => {
  it('parses advance note tag', () => {
    const parsed = parseAdvanceFromNextMonthNote(
      '[AdvanceFromNextMonth: from=2026-06; to=2026-05]',
    );
    expect(parsed).toEqual({ from: { year: 2026, month: 6 }, to: { year: 2026, month: 5 } });
  });

  it('builds symmetric note tag', () => {
    expect(buildAdvanceFromNextMonthNoteTag({ year: 2026, month: 6 }, { year: 2026, month: 5 })).toBe(
      '[AdvanceFromNextMonth: from=2026-06; to=2026-05]',
    );
  });

  it('computes next financial month with monthStartDay', () => {
    const next = nextFinancialMonthKey({ year: 2026, month: 5 }, 28);
    expect(next.year).toBe(2026);
    expect(next.month).toBeGreaterThanOrEqual(5);
    expect(next.month).toBeLessThanOrEqual(6);
  });

  it('returns headroom from next month row', () => {
    const budgets: Budget[] = [
      {
        id: '1',
        user_id: 'u',
        category: 'Food',
        limit: 1000,
        month: 6,
        year: 2026,
        period: 'monthly',
      },
    ];
    const headroom = computeNextMonthBorrowHeadroomSar({
      budgets,
      category: 'Food',
      currentView: { year: 2026, month: 5 },
      monthStartDay: 1,
      spentByCategoryNextMonth: new Map([['Food', 200]]),
    });
    expect(headroom).toBe(800);
  });

  it('summarizes finalized advance transfers for a month', () => {
    const requests: BudgetRequest[] = [
      {
        id: 'r1',
        userId: 'u',
        requestType: 'AdvanceFromNextMonth',
        categoryName: 'Food',
        amount: 300,
        status: 'Finalized',
        note: '[Request mode: AdvanceFromNextMonth] [AdvanceFromNextMonth: from=2026-06; to=2026-05]',
      },
    ];
    const xfer = summarizeFinalizedAdvanceTransfers({
      requests,
      category: 'Food',
      month: { year: 2026, month: 5 },
    });
    expect(xfer.borrowedInSar).toBe(300);
    expect(xfer.lentOutSar).toBe(0);
  });
});
