import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('financial month surface coverage', () => {
  it('transaction intelligence uses fiscal lookback when data is passed', () => {
    const src = read('services/transactionIntelligence.ts');
    expect(src).toContain('financialMonthLookbackRange');
    expect(src).toContain('txInLookbackWindow');
    expect(src).toContain('financialMonthKeyFromTransactionDate');
    expect(src).toMatch(/expenseTotalsByBudgetCategorySar[\s\S]*dateInRange/);
  });

  it('key pages wire fiscal month helpers for KPIs and filters', () => {
    expect(read('pages/Analysis.tsx')).toMatch(/spendByMerchantSar\([^)]+data:\s*engineData/);
    expect(read('pages/Liabilities.tsx')).toContain('financialMonthLookbackRange');
    expect(read('pages/Liabilities.tsx')).toContain('dateInRange');
    expect(read('pages/RiskTradingHub.tsx')).toContain('financialMonthLookbackRange');
    expect(read('pages/Plan.tsx')).toContain('dateInRange');
    expect(read('pages/Budgets.tsx')).toMatch(/sharedTxMonthFilter[\s\S]*dateInRange/);
    expect(read('pages/Transactions.tsx')).toContain('financialMonthKey(now, monthStartDay)');
    expect(read('pages/Transactions.tsx')).toMatch(/formatLedgerDateYmd\(start\)/);
    expect(read('pages/Budgets.tsx')).toMatch(/formatLedgerDateYmd\(start\)/);
    expect(read('pages/Dashboard.tsx')).toContain('financialMonthLookbackRange');
    expect(read('services/goalProjectionFunding.ts')).toContain('financialMonthKeyFromTransactionDate');
    expect(read('services/financeMetrics.ts')).toMatch(/netCashFlowForMonth[\s\S]*dateInRange/);
  });

  it('salary coverage passes data into fiscal detectors', () => {
    expect(read('services/salaryExpenseCoverage.ts')).toMatch(/detectSalaryIncomeSar\([^)]+data/);
    expect(read('services/salaryExpenseCoverage.ts')).toMatch(/normalizedMonthlyExpenseSar\([^)]+data/);
  });
});
