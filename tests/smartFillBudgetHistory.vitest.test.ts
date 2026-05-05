import { describe, it, expect } from 'vitest';
import {
    aggregateSmartFillSpendByCategorySar,
    buildSmartFillThreeFinancialMonthSegments,
    monthlySuggestionsFromCategoryTotals,
} from '../services/smartFillBudgetHistory';

describe('buildSmartFillThreeFinancialMonthSegments', () => {
    it('caps the latest segment end to refNow (partial current month)', () => {
        const ref = new Date(2026, 4, 10, 12, 0, 0, 0); // May 10, 2026 local
        const segs = buildSmartFillThreeFinancialMonthSegments(2026, 5, 1, ref);
        expect(segs).toHaveLength(3);
        const last = segs[2];
        expect(last.start.getFullYear()).toBe(2026);
        expect(last.start.getMonth()).toBe(4); // May
        expect(last.end.getFullYear()).toBe(2026);
        expect(last.end.getMonth()).toBe(4);
        expect(last.end.getDate()).toBe(10);
        expect(last.end.getHours()).toBe(23);
    });

    it('includes full prior months when refNow is after those periods', () => {
        const ref = new Date(2026, 5, 1, 12, 0, 0, 0); // June 1, 2026
        const segs = buildSmartFillThreeFinancialMonthSegments(2026, 5, 1, ref);
        expect(segs).toHaveLength(3);
        const may = segs[2];
        expect(may.end.getMonth()).toBe(4);
        expect(may.end.getDate()).toBeGreaterThanOrEqual(28);
    });
});

describe('aggregateSmartFillSpendByCategorySar', () => {
    it('converts USD expense lines to SAR like budget cards', () => {
        const segments = [{ start: new Date(2026, 3, 1, 0, 0, 0, 0), end: new Date(2026, 3, 30, 23, 59, 59, 999) }];
        const accountCurrencyById = new Map<string, 'SAR' | 'USD'>([['acc1', 'USD']]);
        const txs = [
            {
                type: 'expense' as const,
                amount: -100,
                date: '2026-04-15',
                status: 'Approved' as const,
                budgetCategory: 'Food',
                currency: 'USD' as const,
                accountId: 'acc1',
            },
        ];
        const totals = aggregateSmartFillSpendByCategorySar(segments, txs, [], 3.75, accountCurrencyById);
        expect(totals.get('Food')).toBe(375);
    });

    it('ignores pending expenses', () => {
        const segments = [{ start: new Date(2026, 3, 1), end: new Date(2026, 3, 30, 23, 59, 59, 999) }];
        const map = new Map<string, 'SAR' | 'USD'>();
        const txs = [
            {
                type: 'expense' as const,
                amount: -500,
                date: '2026-04-10',
                status: 'Pending' as const,
                budgetCategory: 'Food',
                accountId: 'a',
            },
        ];
        const totals = aggregateSmartFillSpendByCategorySar(segments, txs, [], 3.75, map);
        expect(totals.get('Food')).toBeUndefined();
    });

    it('rolls shared approved spend into the same category totals', () => {
        const segments = [{ start: new Date(2026, 3, 1), end: new Date(2026, 3, 30, 23, 59, 59, 999) }];
        const map = new Map<string, 'SAR' | 'USD'>();
        const shared = [
            {
                status: 'Approved',
                transaction_date: '2026-04-12',
                budget_category: 'Food',
                amount: -200,
                currency: 'SAR',
                accountId: 'x',
            },
        ];
        const totals = aggregateSmartFillSpendByCategorySar(segments, [], shared, 3.75, map);
        expect(totals.get('Food')).toBe(200);
    });
});

describe('monthlySuggestionsFromCategoryTotals', () => {
    it('divides by segment count', () => {
        const m = new Map<string, number>([['Food', 900]]);
        const s = monthlySuggestionsFromCategoryTotals(m, 3);
        expect(s).toEqual([{ category: 'Food', monthly: 300 }]);
    });
});
