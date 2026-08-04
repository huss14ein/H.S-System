import { describe, expect, it } from 'vitest';
import { computeSalaryInvestmentKpis } from '../services/salaryInvestmentKpis';
import { normalizeSalaryInvestmentTargets } from '../services/salaryInvestmentSettings';

/** Stable YYYY-MM-DD inside the current calendar month (KPI window is “this financial month”). */
function currentMonthDay(day: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(Math.min(28, Math.max(1, day))).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('salary investment KPIs', () => {
  it('computes salary-funded deposits, deployment, idle broker cash, and history', () => {
    const data = {
      settings: {
        monthStartDay: 1,
        salaryInvestmentTargets: {
          monthlyInvestTargetSar: 5000,
          salaryIncomeCategories: ['salary'],
          includeBonusInSalaryIncome: false,
          salarySourceAccountId: 'checking-1',
        },
      },
      accounts: [
        { id: 'checking-1', name: 'Salary Checking', type: 'Checking', balance: 10000, currency: 'SAR', accountRole: 'salary_receiving' },
        { id: 'broker-1', name: 'Broker One', type: 'Investment', balance: 0, currency: 'SAR' },
      ],
      transactions: [
        { id: 'tx-salary', accountId: 'checking-1', amount: 12000, type: 'income', category: 'Salary', description: 'Monthly salary', date: currentMonthDay(5) },
        { id: 'tx-expense', accountId: 'checking-1', amount: -3000, type: 'expense', category: 'Housing', description: 'Rent', date: currentMonthDay(10) },
      ],
      investments: [
        {
          id: 'portfolio-1',
          name: 'Growth',
          accountId: 'broker-1',
          currency: 'SAR',
          holdings: [{ id: 'h1', symbol: 'AAPL', assetClass: 'Stock', goalId: 'goal-growth' }],
        },
      ],
      investmentTransactions: [
        { id: 'dep-1', accountId: 'broker-1', linkedCashAccountId: 'checking-1', date: currentMonthDay(7), type: 'deposit', symbol: 'CASH', quantity: 0, price: 0, total: 4000, currency: 'SAR' },
        { id: 'buy-1', accountId: 'broker-1', portfolioId: 'portfolio-1', date: currentMonthDay(9), type: 'buy', symbol: 'AAPL', quantity: 5, price: 500, total: 2500, currency: 'SAR' },
      ],
    } as any;

    const result = computeSalaryInvestmentKpis(data, 3.75);
    expect(result).not.toBeNull();
    expect(result?.salaryIncomeSarMonth).toBe(12000);
    expect(result?.investedFromSalarySarMonth).toBe(4000);
    expect(result?.deployedSarMonth).toBe(2500);
    expect(result?.fundedNotDeployedSar).toBe(1500);
    expect(result?.salaryInvestRatePct).toBeCloseTo(33.333, 2);
    expect(result?.salaryFundingByPlatform[0]?.label).toBe('Broker One');
    expect(result?.salaryFundingByAssetClass[0]?.label).toBe('Stock');
    expect(result?.salaryFundingByGoal[0]?.label).toBe('goal-growth');
    expect(result?.history.length).toBe(6);
  });

  it('sanitizes nested target settings and strips unsafe entries', () => {
    const normalized = normalizeSalaryInvestmentTargets({
      monthlyInvestTargetSar: 6000,
      platformTargets: {
        broker1: 3000,
        __proto__: 999999,
      },
      assetClassTargets: {
        Stock: 2000,
        Crypto: -50,
      },
      salaryIncomeCategories: ['salary', ' payroll ', '', '__proto__'],
      investLagAlertDays: 99,
      includeBonusInSalaryIncome: true,
    });

    expect(normalized?.monthlyInvestTargetSar).toBe(6000);
    expect(normalized?.platformTargets).toEqual({ broker1: 3000 });
    expect(normalized?.assetClassTargets).toEqual({ Stock: 2000 });
    expect(normalized?.salaryIncomeCategories).toEqual(['salary', 'payroll']);
    expect(normalized?.investLagAlertDays).toBe(28);
    expect(normalized?.includeBonusInSalaryIncome).toBe(true);
  });

  it('proportional funded-not-deployed when mixed salary and non-salary deposits', () => {
    const data = {
      settings: {
        monthStartDay: 1,
        salaryInvestmentTargets: {
          salarySourceAccountId: 'checking-1',
          defaultFundingAccountId: 'checking-1',
        },
      },
      accounts: [
        { id: 'checking-1', name: 'Salary Checking', type: 'Checking', balance: 10000, currency: 'SAR', accountRole: 'salary_receiving' },
        { id: 'other-cash', name: 'Other Cash', type: 'Checking', balance: 5000, currency: 'SAR' },
        { id: 'broker-1', name: 'Broker One', type: 'Investment', balance: 0, currency: 'SAR' },
      ],
      transactions: [
        { id: 'tx-salary', accountId: 'checking-1', amount: 10000, type: 'income', category: 'Salary', description: 'Monthly salary', date: currentMonthDay(5) },
      ],
      investments: [
        {
          id: 'portfolio-1',
          name: 'Growth',
          accountId: 'broker-1',
          currency: 'SAR',
          holdings: [{ id: 'h1', symbol: 'AAPL', assetClass: 'Stock', goalId: 'goal-growth' }],
        },
      ],
      investmentTransactions: [
        { id: 'dep-salary', accountId: 'broker-1', linkedCashAccountId: 'checking-1', date: currentMonthDay(7), type: 'deposit', symbol: 'CASH', quantity: 0, price: 0, total: 1000, currency: 'SAR' },
        { id: 'dep-other', accountId: 'broker-1', linkedCashAccountId: 'other-cash', date: currentMonthDay(7), type: 'deposit', symbol: 'CASH', quantity: 0, price: 0, total: 4000, currency: 'SAR' },
        { id: 'buy-1', accountId: 'broker-1', portfolioId: 'portfolio-1', date: currentMonthDay(9), type: 'buy', symbol: 'AAPL', quantity: 2, price: 500, total: 1000, currency: 'SAR' },
      ],
    } as any;

    const result = computeSalaryInvestmentKpis(data, 3.75);
    expect(result?.investedFromSalarySarMonth).toBe(1000);
    expect(result?.investedTotalSarMonth).toBe(5000);
    expect(result?.deployedSarMonth).toBe(1000);
    // 20% of buys attributed to salary → idle salary cash = 1000 - 200 = 800
    expect(result?.fundedNotDeployedSar).toBe(800);
    expect(result?.salaryFundingByAssetClass[0]?.sar).toBe(200);
  });

  it('does not treat broker platform id as cash funding fallback for unlinked deposits', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [
        { id: 'checking-1', name: 'Funding', type: 'Checking', balance: 10000, currency: 'SAR', accountRole: 'investment_funding' },
        { id: 'broker-1', name: 'Broker One', type: 'Investment', balance: 0, currency: 'SAR' },
      ],
      transactions: [],
      investments: [{ id: 'portfolio-1', name: 'Growth', accountId: 'broker-1', currency: 'SAR', holdings: [] }],
      investmentTransactions: [
        { id: 'dep-unlinked', accountId: 'broker-1', date: currentMonthDay(7), type: 'deposit', symbol: 'CASH', quantity: 0, price: 0, total: 2000, currency: 'SAR' },
      ],
    } as any;
    const result = computeSalaryInvestmentKpis(data, 3.75);
    expect(result?.investedFromSalarySarMonth).toBe(0);
    expect(result?.unlinkedBrokerFundingSar).toBe(2000);
  });
});
