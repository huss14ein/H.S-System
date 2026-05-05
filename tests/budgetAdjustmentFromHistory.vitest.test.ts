import { describe, it, expect } from 'vitest';
import { aggregateSpendThroughMonthByBudgetCategorySar, distinctMonthCount } from '../services/budgetAdjustmentFromHistory';
import { learnAndAutoAdjust } from '../services/aiBudgetAutomation';

describe('aggregateSpendThroughMonthByBudgetCategorySar', () => {
    const mapAcc = new Map<string, 'SAR' | 'USD'>([['a1', 'SAR']]);

    it('uses financial month keys and excludes months after currentMonth', () => {
        const txs = [
            {
                type: 'expense' as const,
                amount: -100,
                date: '2026-01-15',
                status: 'Approved' as const,
                budgetCategory: 'Food',
                accountId: 'a1',
            },
            {
                type: 'expense' as const,
                amount: -200,
                date: '2026-03-10',
                status: 'Approved' as const,
                budgetCategory: 'Food',
                accountId: 'a1',
            },
            {
                type: 'expense' as const,
                amount: -999,
                date: '2026-06-01',
                status: 'Approved' as const,
                budgetCategory: 'Food',
                accountId: 'a1',
            },
        ];
        const agg = aggregateSpendThroughMonthByBudgetCategorySar(txs, [], {
            currentYear: 2026,
            currentMonth: 3,
            monthStartDay: 1,
            sarPerUsd: 3.75,
            accountCurrencyById: mapAcc,
        });
        const row = agg.get('Food');
        expect(row?.totalSar).toBe(300);
        expect(distinctMonthCount(row)).toBe(2);
    });

    it('allocates split lines in SAR', () => {
        const txs = [
            {
                type: 'expense' as const,
                amount: -100,
                date: '2026-02-01',
                status: 'Approved' as const,
                budgetCategory: 'Food',
                accountId: 'a1',
                currency: 'USD',
                splitLines: [
                    { category: 'Food', amount: 40 },
                    { category: 'Transportation', amount: 60 },
                ],
            },
        ];
        const usdMap = new Map<string, 'SAR' | 'USD'>([['a1', 'USD']]);
        const agg = aggregateSpendThroughMonthByBudgetCategorySar(txs, [], {
            currentYear: 2026,
            currentMonth: 6,
            monthStartDay: 1,
            sarPerUsd: 3.75,
            accountCurrencyById: usdMap,
        });
        expect(agg.get('Food')).toBeDefined();
        expect(agg.get('Transportation')).toBeDefined();
        expect(agg.get('Food')!.totalSar + agg.get('Transportation')!.totalSar).toBe(375);
    });

    it('merges approved shared rows', () => {
        const shared = [
            {
                status: 'Approved',
                transaction_date: '2026-04-05',
                budget_category: 'Food',
                amount: -50,
                currency: 'SAR',
                accountId: 'a1',
            },
        ];
        const agg = aggregateSpendThroughMonthByBudgetCategorySar([], shared, {
            currentYear: 2026,
            currentMonth: 4,
            monthStartDay: 1,
            sarPerUsd: 3.75,
            accountCurrencyById: mapAcc,
        });
        expect(agg.get('Food')?.totalSar).toBe(50);
    });
});

describe('learnAndAutoAdjust', () => {
    it('raises monthly limit when average spend exceeds 120% of monthly equivalent', async () => {
        const txs = [
            { id: '1', description: 'x', date: '2026-01-15', amount: -1200, category: 'x', accountId: 'a', type: 'expense' as const, status: 'Approved' as const, budgetCategory: 'Food' },
            { id: '2', description: 'y', date: '2026-02-15', amount: -1200, category: 'x', accountId: 'a', type: 'expense' as const, status: 'Approved' as const, budgetCategory: 'Food' },
        ];
        const budgets = [
            { id: 'b1', category: 'Food', limit: 800, month: 6, year: 2026, period: 'monthly' as const },
        ];
        const ctx = {
            monthStartDay: 1,
            sarPerUsd: 3.75,
            accountCurrencyById: new Map<string, 'SAR' | 'USD'>([['a', 'SAR']]),
            ownerSharedTransactions: [] as any[],
        };
        const out = await learnAndAutoAdjust(txs as any, budgets as any, 6, 2026, ctx);
        const food = out.find((b) => b.category === 'Food');
        expect(food?.limit).toBeGreaterThan(800);
    });

    it('respects weekly budget period via monthly equivalent', async () => {
        const txs = [
            { id: '1', description: 'x', date: '2026-01-10', amount: -600, category: 'x', accountId: 'a', type: 'expense' as const, status: 'Approved' as const, budgetCategory: 'Fuel' },
            { id: '2', description: 'y', date: '2026-02-10', amount: -600, category: 'x', accountId: 'a', type: 'expense' as const, status: 'Approved' as const, budgetCategory: 'Fuel' },
        ];
        // Weekly 100 → monthly equiv 100*(52/12); avg 600 exceeds 120% of that → limit should rise
        const budgets = [
            { id: 'b1', category: 'Fuel', limit: 100, month: 3, year: 2026, period: 'weekly' as const },
        ];
        const ctx = {
            monthStartDay: 1,
            sarPerUsd: 3.75,
            accountCurrencyById: new Map<string, 'SAR' | 'USD'>([['a', 'SAR']]),
            ownerSharedTransactions: [] as any[],
        };
        const out = await learnAndAutoAdjust(txs as any, budgets as any, 3, 2026, ctx);
        const fuel = out.find((b) => b.category === 'Fuel');
        expect(fuel?.limit).not.toBe(100);
    });
});
