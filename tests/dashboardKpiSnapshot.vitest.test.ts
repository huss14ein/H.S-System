import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import type { FinancialData, Account, Transaction } from '../types';

const mockFx = () => 3.75;

vi.mock('../services/fxDailySeries', () => ({
  hydrateSarPerUsdDailySeries: vi.fn(),
  fxMapForKpiCompute: vi.fn(() => ({})),
  getSarPerUsdForCalendarDay: vi.fn(() => mockFx()),
  loadSarPerUsdByDay: vi.fn(() => ({})),
}));

describe('computeDashboardKpiSnapshot', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('respects monthStartDay 28 for monthly P&L and budget variance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 5, 12, 0, 0));
    const accounts: Account[] = [{ id: 'a1', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' } as Account];
    const data = {
      settings: { monthStartDay: 28 },
      accounts,
      personalAccounts: accounts,
      transactions: [
        { id: 'in', date: '2026-06-10', type: 'expense', amount: -200, accountId: 'a1', category: 'Food', status: 'Approved' } as Transaction,
        { id: 'out', date: '2026-06-29', type: 'expense', amount: -900, accountId: 'a1', category: 'Food', status: 'Approved' } as Transaction,
        { id: 'inc', date: '2026-06-15', type: 'income', amount: 5000, accountId: 'a1', category: 'Salary', status: 'Approved' } as Transaction,
      ],
      budgets: [{ id: 'b1', category: 'Food', limit: 1000, month: 5, year: 2026, period: 'monthly' }],
      investments: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const snap = computeDashboardKpiSnapshot(data, 3.75, () => ({ SAR: 0, USD: 0 }));
    expect(snap).not.toBeNull();
    expect(snap!.monthlyPnL).toBeCloseTo(4800, 0);
    expect(snap!.budgetVariance).toBeCloseTo(800, 0);
  });

  it('converts USD checking balance to SAR for liquidCashSar', () => {
    const accounts: Account[] = [
      { id: 'a1', name: 'USD Check', type: 'Checking', balance: 1000, currency: 'USD' } as Account,
    ];
    const data = {
      accounts,
      personalAccounts: accounts,
      transactions: [] as Transaction[],
      budgets: [],
      investments: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const snap = computeDashboardKpiSnapshot(data, 3.75, () => ({ SAR: 0, USD: 0 }));
    expect(snap).not.toBeNull();
    expect(snap!.liquidCashSar).toBeCloseTo(3750, 0);
    expect(snap!.investmentCapitalSource).toBeDefined();
  });

  it('includes investment platform cash from getAvailableCashForAccount in liquidCashSar', () => {
    const accounts: Account[] = [
      { id: 'c1', name: 'Check', type: 'Checking', balance: 1000, currency: 'SAR' } as Account,
      { id: 'inv1', name: 'Broker', type: 'Investment', balance: 5000, currency: 'SAR' } as Account,
    ];
    const data = {
      accounts,
      personalAccounts: accounts,
      transactions: [] as Transaction[],
      budgets: [],
      investments: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const snap = computeDashboardKpiSnapshot(data, 3.75, (id) =>
      id === 'inv1' ? { SAR: 5000, USD: 0 } : { SAR: 0, USD: 0 },
    );
    expect(snap).not.toBeNull();
    expect(snap!.liquidCashSar).toBeCloseTo(6000, 0);
  });

  it('averages 6-month income in SAR via txCashflowSar', () => {
    const accounts: Account[] = [{ id: 'a1', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' } as Account];
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), 5).toISOString().slice(0, 10);
    const txs: Transaction[] = [
      { id: '1', date: d0, type: 'income', amount: 6000, accountId: 'a1', category: 'Salary' } as Transaction,
    ];
    const data = {
      accounts,
      personalAccounts: accounts,
      personalTransactions: txs,
      transactions: txs,
      budgets: [],
      investments: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const snap = computeDashboardKpiSnapshot(data, 3.75, () => ({ SAR: 0, USD: 0 }));
    expect(snap).not.toBeNull();
    expect(snap!.avgMonthlyIncomeSar6Mo).toBeCloseTo(1000, 0);
  });
});
