import { describe, it, expect } from 'vitest';
import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { computePersonalInvestmentKpiBreakdown } from '../services/investmentKpiCore';

const SAR_PER_USD = 3.75;
const PLATFORM_ID = 'platform-inv-1';

function basePortfolio(overrides: Partial<InvestmentPortfolio> = {}): InvestmentPortfolio {
  return {
    id: 'pf-sar-1',
    name: 'Tadawul',
    accountId: PLATFORM_ID,
    currency: 'SAR',
    holdings: [],
    ...overrides,
  };
}

function baseAccount(): Account {
  return {
    id: PLATFORM_ID,
    name: 'Investment platform',
    type: 'Investment',
    balance: 0,
  } as Account;
}

function tx(partial: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'id' | 'type' | 'total'>): InvestmentTransaction {
  return {
    accountId: PLATFORM_ID,
    date: '2025-06-15',
    symbol: 'CASH',
    quantity: 0,
    price: 0,
    currency: 'SAR',
    ...partial,
  } as InvestmentTransaction;
}

describe('investmentKpiCore capital source when deposits missing', () => {
  const getCashZero = () => ({ SAR: 0, USD: 0 });

  it('uses ledger_inferred when buys align with avg-cost fallback (no deposits)', () => {
    const holding: Holding = {
      id: 'h1',
      symbol: '2222.SR',
      quantity: 100,
      avgCost: 50,
      currentValue: 5_000,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
    };
    const data = {
      accounts: [baseAccount()],
      personalAccounts: [baseAccount()],
      investments: [basePortfolio({ holdings: [holding] })],
      personalInvestments: [basePortfolio({ holdings: [holding] })],
      investmentTransactions: [
        tx({ id: 'b1', type: 'buy', symbol: '2222.SR', quantity: 100, price: 50, total: 5_000 }),
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const b = computePersonalInvestmentKpiBreakdown(data, SAR_PER_USD, getCashZero);
    expect(b.depositsRecordedSar).toBe(0);
    expect(b.capitalSource).toBe('ledger_inferred');
    expect(b.totalInvestedSar).toBeCloseTo(5_000, 5);
  });

  it('falls back to cost_basis when ledger-implied gross wildly exceeds avg-cost fallback', () => {
    const holding: Holding = {
      id: 'h1',
      symbol: '2222.SR',
      quantity: 100,
      avgCost: 50,
      currentValue: 5_000,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
    };
    const data = {
      accounts: [baseAccount()],
      personalAccounts: [baseAccount()],
      investments: [basePortfolio({ holdings: [holding] })],
      personalInvestments: [basePortfolio({ holdings: [holding] })],
      investmentTransactions: [
        tx({ id: 'b1', type: 'buy', symbol: '2222.SR', quantity: 100, price: 50, total: 500_000 }),
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const b = computePersonalInvestmentKpiBreakdown(data, SAR_PER_USD, getCashZero);
    expect(b.depositsRecordedSar).toBe(0);
    expect(b.capitalSource).toBe('cost_basis_fallback');
    expect(b.totalInvestedSar).toBeCloseTo(b.fallbackInvestedSar, 5);
  });

  it('falls back to cost_basis when ledger-implied gross is far below avg-cost fallback', () => {
    const holding: Holding = {
      id: 'h1',
      symbol: '2222.SR',
      quantity: 100,
      avgCost: 80,
      currentValue: 8_000,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
    };
    const data = {
      accounts: [baseAccount()],
      personalAccounts: [baseAccount()],
      investments: [basePortfolio({ holdings: [holding] })],
      personalInvestments: [basePortfolio({ holdings: [holding] })],
      investmentTransactions: [
        tx({ id: 'b1', type: 'buy', symbol: '2222.SR', quantity: 10, price: 80, total: 800 }),
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const b = computePersonalInvestmentKpiBreakdown(data, SAR_PER_USD, getCashZero);
    expect(b.depositsRecordedSar).toBe(0);
    expect(b.fallbackInvestedSar).toBeGreaterThan(400);
    expect(b.capitalSource).toBe('cost_basis_fallback');
  });
});
