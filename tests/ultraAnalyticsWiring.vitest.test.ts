/**
 * Ultra analytics E2E wiring — period sync, cross-filter, shared workspace.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAnalyticsSpendWindow } from '../services/analyticsPeriodRange';
import { computeExpenseBudgetAnalysisModel } from '../services/expenseBudgetAnalysisModel';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('ultraAnalyticsWiring', () => {
  it('period preset changes spend window and model totals', () => {
    const ref = new Date(2026, 5, 15);
    const mtd = resolveAnalyticsSpendWindow(ref, 1, 'MTD');
    const threeM = resolveAnalyticsSpendWindow(ref, 1, '3M');
    expect(threeM.finKeys.length).toBe(3);
    expect(threeM.start).not.toBe(mtd.start);

    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' }],
      budgets: [{ id: 'b1', category: 'Food', limit: 1000, month: 4, year: 2026, period: 'monthly' }],
      transactions: [
        {
          id: 't1',
          date: '2026-04-10',
          description: 'Grocery',
          amount: -400,
          category: 'Food',
          budgetCategory: 'Food',
          type: 'expense',
          accountId: 'a1',
          status: 'Approved',
        },
        {
          id: 't2',
          date: '2026-06-10',
          description: 'Grocery',
          amount: -300,
          category: 'Food',
          budgetCategory: 'Food',
          type: 'expense',
          accountId: 'a1',
          status: 'Approved',
        },
      ],
    } as unknown as FinancialData;

    const mtdModel = computeExpenseBudgetAnalysisModel(data, 3.75, ref, 'personal', 'MTD');
    const threeMModel = computeExpenseBudgetAnalysisModel(data, 3.75, ref, 'personal', '3M');
    expect(mtdModel!.summary.expenseSar).toBeCloseTo(300, 0);
    expect(threeMModel!.summary.expenseSar).toBeCloseTo(700, 0);
    expect(threeMModel!.periodPreset).toBe('3M');
  });

  it('Analysis and Wealth Analytics share period bar + hook preset', () => {
    expect(read('pages/Analysis.tsx')).toContain('periodPreset');
    expect(read('pages/WealthAnalytics.tsx')).toContain('AnalyticsPeriodScopeBar');
    expect(read('pages/WealthAnalytics.tsx')).toContain('periodPreset');
    expect(read('hooks/useSpendingCommandCenterModel.ts')).toContain('periodPreset');
  });

  it('drill-down sets cross-filter category in workspace', () => {
    expect(read('services/spendingDrillDown.ts')).toContain('setSelectedCategory');
    expect(read('components/analysis/ExpenseBudgetAnalysisPanel.tsx')).toContain('selectedCategory');
    expect(read('pages/WealthAnalytics.tsx')).toContain('selectedCategory');
  });

  it('merchant treemap and corporate action hydrate exist', () => {
    expect(read('components/analysis/AnalysisExplorerContent.tsx')).toContain('SpendingMerchantTreemap');
    expect(read('components/analysis/AnalysisExplorerContent.tsx')).toContain("analysisExplorerTab === 'position'");
    expect(read('components/analysis/AnalysisExplorerContent.tsx')).toContain('Balance sheet position');
    expect(read('context/DataContext.tsx')).toContain('corporate_action_events');
    expect(read('services/analyticsInsightEngine.ts')).toContain('buildAnalyticsInsightFeed');
    expect(read('components/analysis/AnalyticsInsightCards.tsx')).toContain('buildAnalyticsInsightFeed');
  });
});
