import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('financial month KPI coverage', () => {
  it('canonical KPI paths use dateInRange and budgetsForFinancialMonthView', () => {
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('dateInRange');
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('budgetsForFinancialMonthView');
    expect(read('pages/Dashboard.tsx')).toContain('budgetsForFinancialMonthView');
    expect(read('pages/Dashboard.tsx')).toContain('financialMonthDaysRemaining');
    expect(read('components/dashboard/BudgetBurnRatePanel.tsx')).toContain('budgetsForFinancialMonthView');
    expect(read('components/dashboard/BudgetBurnRatePanel.tsx')).toContain('financialMonthLabel');
    expect(read('components/dashboard/ExpenseDonutDrilldown.tsx')).toContain('dateInRange');
    expect(read('components/dashboard/MomCashflowTrendChart.tsx')).toContain('financialMonthKeyLabel');
    expect(read('services/wealthSummaryReportModel.ts')).toContain('budgetsForFinancialMonthView');
    expect(read('hooks/useEmergencyFund.ts')).toContain('financialMonthKeyFromTransactionDate');
    expect(read('services/expenseBudgetAnalysisModel.ts')).toContain('budgetsForFinancialMonthView');
    expect(read('context/NotificationsContext.tsx')).toContain('currentFinancialMonthIso');
    expect(read('services/transactionIntelligence.ts')).toContain('financialMonthLookbackRange');
    expect(read('pages/Analysis.tsx')).toMatch(/detectSalaryIncomeSar\([^)]+engineData/);
  });

  it('normalized monthly expense uses financial months when data is passed', () => {
    expect(read('services/financeMetrics.ts')).toMatch(/normalizedMonthlyExpenseSar[\s\S]*opts\?\.data/);
    expect(read('services/netWorthSnapshotExtended.ts')).toMatch(/normalizedMonthlyExpenseSar\([^)]+data/);
  });
});
