import { describe, expect, it } from 'vitest';
import {
  buildInvestmentAccountKpiScope,
  deriveLedgerCashBucketsFromInvestmentTransactions,
  scopeInvestmentTransactionsForPersonalAccount,
} from '../services/investmentAccountKpiScope';
import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('investmentAccountKpiScope', () => {
  const account: Account = { id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 };
  const p1: InvestmentPortfolio = {
    id: 'p1',
    name: 'Personal',
    accountId: 'acc-1',
    currency: 'SAR',
    holdings: [],
  };
  const m1: InvestmentPortfolio = {
    id: 'm1',
    name: 'Managed',
    accountId: 'acc-1',
    currency: 'SAR',
    holdings: [],
  };

  it('detects mixed ownership when managed portfolios share the broker account', () => {
    const scoped = scopeInvestmentTransactionsForPersonalAccount({
      account,
      personalPortfolios: [p1],
      allInvestments: [p1, m1],
      accounts: [account],
      accountTransactions: [],
    });
    expect(scoped.hasMixedOwnership).toBe(true);
    expect(scoped.allPortfoliosOnAccount.map((p) => p.id).sort()).toEqual(['m1', 'p1']);
  });

  it('excludes managed-portfolio flows from personal metrics transactions', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'd-managed',
        accountId: 'acc-1',
        portfolioId: 'm1',
        type: 'deposit',
        date: '2026-05-20',
        total: 5000,
        currency: 'SAR',
      },
      {
        id: 'd-personal',
        accountId: 'acc-1',
        portfolioId: 'p1',
        type: 'deposit',
        date: '2026-05-21',
        total: 200,
        currency: 'SAR',
      },
    ];
    const scoped = scopeInvestmentTransactionsForPersonalAccount({
      account,
      personalPortfolios: [p1],
      allInvestments: [p1, m1],
      accounts: [account],
      accountTransactions: txs,
    });
    expect(scoped.transactionsForMetrics.map((t) => t.id)).toEqual(['d-personal']);
  });

  it('uses ledger cash buckets under mixed ownership instead of full account cash', () => {
    const data = {
      accounts: [account],
      investments: [p1, m1],
      investmentTransactions: [
        {
          id: 'd-managed',
          accountId: 'acc-1',
          portfolioId: 'm1',
          type: 'deposit',
          date: '2026-05-20',
          total: 5000,
          currency: 'SAR',
        },
        {
          id: 'd-personal',
          accountId: 'acc-1',
          portfolioId: 'p1',
          type: 'deposit',
          date: '2026-05-21',
          total: 200,
          currency: 'SAR',
        },
      ],
    } as FinancialData;

    const scope = buildInvestmentAccountKpiScope({
      account,
      personalPortfolios: [p1],
      data,
      accountTransactions: data.investmentTransactions ?? [],
      getAvailableCashForAccount: () => ({ SAR: 5200, USD: 0 }),
    });

    expect(scope.hasMixedOwnership).toBe(true);
    expect(scope.availableCashByCurrency.SAR).toBeCloseTo(200, 0);
    expect(scope.availableCashByCurrency.USD).toBe(0);
  });

  it('deriveLedgerCashBucketsFromInvestmentTransactions nets buys and withdrawals', () => {
    const txs: InvestmentTransaction[] = [
      { id: 'd1', type: 'deposit', total: 1000, currency: 'SAR', date: '2026-05-01' },
      { id: 'b1', type: 'buy', total: 300, currency: 'SAR', date: '2026-05-02' },
      { id: 'w1', type: 'withdrawal', total: 100, currency: 'SAR', date: '2026-05-03' },
    ];
    const buckets = deriveLedgerCashBucketsFromInvestmentTransactions({
      transactions: txs,
      accounts: [account],
      allInvestments: [p1],
    });
    expect(buckets.SAR).toBeCloseTo(600, 0);
  });
});
