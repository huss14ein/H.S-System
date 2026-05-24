import { describe, it, expect } from 'vitest';
import type { Account, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  brokerCashBucketsFromInvestmentAccount,
  buildInvestableCashBarsFromInvestmentAccounts,
  computeAvailableCashByAccountMap,
  computeBrokerCashByAccountMap,
  getTradableCashBucketsForAccount,
  sumTradableCashSarFromInvestmentAccounts,
} from '../services/investmentCashLedger';

function invAccount(overrides: Partial<Account> = {}): Account {
  return { id: 'inv-1', name: 'Broker', type: 'Investment', balance: 0, ...overrides } as Account;
}

function portfolioUSD(): InvestmentPortfolio {
  return { id: 'pf-1', name: 'US', accountId: 'inv-1', currency: 'USD', holdings: [] } as InvestmentPortfolio;
}

function tx(partial: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'id' | 'type' | 'total'> & { created_at?: string }): InvestmentTransaction {
  return {
    id: partial.id,
    accountId: partial.accountId ?? 'inv-1',
    date: partial.date ?? '2026-04-11',
    type: partial.type,
    symbol: partial.symbol ?? 'CASH',
    quantity: partial.quantity ?? 0,
    price: partial.price ?? 0,
    total: partial.total,
    currency: partial.currency,
    ...(partial.created_at ? { created_at: partial.created_at } : {}),
  } as unknown as InvestmentTransaction;
}

describe('brokerCashBucketsFromInvestmentAccount', () => {
  it('maps SAR investment balance into SAR bucket only', () => {
    expect(brokerCashBucketsFromInvestmentAccount(invAccount({ balance: 1825, currency: 'SAR' as any }))).toEqual({
      SAR: 1825,
      USD: 0,
    });
  });

  it('maps USD investment balance into USD bucket only', () => {
    expect(brokerCashBucketsFromInvestmentAccount(invAccount({ balance: 500, currency: 'USD' as const }))).toEqual({
      SAR: 0,
      USD: 500,
    });
  });

  it('computeBrokerCashByAccountMap keys by canonical investment id', () => {
    const map = computeBrokerCashByAccountMap([
      invAccount({ id: 'inv-1', balance: 100, currency: 'SAR' as any }),
    ]);
    expect(map['inv-1']).toEqual({ SAR: 100, USD: 0 });
  });

  it('computeBrokerCashByAccountMap keeps the row with more cash when two rows share a canonical id', () => {
    const accounts = [
      invAccount({ id: 'inv-1', balance: 0, currency: 'SAR' as any, account_id: 'legacy-ext' } as Account),
      invAccount({ id: 'legacy-ext', balance: 5000, currency: 'SAR' as any }),
    ];
    const map = computeBrokerCashByAccountMap(accounts);
    expect(map['legacy-ext']).toEqual({ SAR: 5000, USD: 0 });
    expect(map['inv-1']).toEqual({ SAR: 0, USD: 0 });
  });
});

describe('getTradableCashBucketsForAccount', () => {
  it('prefers direct investment row id over canonical alias with zero balance', () => {
    const accounts = [
      invAccount({ id: 'legacy-ext', balance: 5000, currency: 'SAR' as any }),
      invAccount({ id: 'inv-1', balance: 0, currency: 'SAR' as any, account_id: 'legacy-ext' } as Account),
    ];
    expect(getTradableCashBucketsForAccount('legacy-ext', accounts)).toEqual({ SAR: 5000, USD: 0 });
    expect(getTradableCashBucketsForAccount('inv-1', accounts)).toEqual({ SAR: 0, USD: 0 });
  });
});

describe('sumTradableCashSarFromInvestmentAccounts', () => {
  it('sums every investment platform balance in scope once (SAR eq.)', () => {
    const accounts = [
      invAccount({ id: 'a', balance: 1000, currency: 'SAR' as any }),
      invAccount({ id: 'b', balance: 200, currency: 'USD' as const }),
    ];
    expect(sumTradableCashSarFromInvestmentAccounts(accounts, accounts, 3.75)).toBeCloseTo(1000 + 200 * 3.75, 6);
  });

  it('uses each scope row balance even when that id is not in allAccounts', () => {
    const allAccounts = [invAccount({ id: 'inv-1', balance: 0, currency: 'SAR' as any, account_id: 'legacy-ext' } as Account)];
    const scope = [invAccount({ id: 'legacy-ext', balance: 5000, currency: 'SAR' as any })];
    expect(sumTradableCashSarFromInvestmentAccounts(scope, allAccounts, 3.75)).toBe(5000);
  });

  it('prefers fresh balance from allAccounts when scope row is stale', () => {
    const fresh = invAccount({ id: 'a', balance: 9000, currency: 'SAR' as any });
    const stale = invAccount({ id: 'a', balance: 1000, currency: 'SAR' as any });
    expect(sumTradableCashSarFromInvestmentAccounts([stale], [fresh], 3.75)).toBe(9000);
  });
});

describe('buildInvestableCashBarsFromInvestmentAccounts', () => {
  it('bar SAR total matches sumTradableCashSarFromInvestmentAccounts', () => {
    const accounts = [
      invAccount({ id: 'a', name: 'Al-Riyadh', balance: 1000, currency: 'SAR' as any }),
      invAccount({ id: 'b', name: 'Awaed', balance: 200, currency: 'USD' as const }),
    ];
    const bars = buildInvestableCashBarsFromInvestmentAccounts(accounts, accounts, 3.75);
    const barTotal = bars.reduce((s, r) => s + r.sar, 0);
    expect(barTotal).toBeCloseTo(sumTradableCashSarFromInvestmentAccounts(accounts, accounts, 3.75), 6);
  });
});

describe('computeAvailableCashByAccountMap', () => {
  it('USD buy can consume SAR bucket by FX conversion when USD bucket is empty', () => {
    const map = computeAvailableCashByAccountMap({
      accounts: [invAccount({ currency: 'SAR' as any })],
      investments: [portfolioUSD()],
      investmentTransactions: [
        tx({ id: 'd-sar', type: 'deposit', total: 10000, currency: 'SAR' }),
        tx({ id: 'b-usd', type: 'buy', total: 1000, currency: 'USD', symbol: 'AAPL', quantity: 5, price: 200 }),
      ],
      sarPerUsd: 3.75,
    });

    expect(map['inv-1'].SAR).toBeCloseTo(6250, 6);
    expect(map['inv-1'].USD).toBeCloseTo(0, 6);
  });

  it('USD buy first consumes USD bucket when available', () => {
    const map = computeAvailableCashByAccountMap({
      accounts: [invAccount({ currency: 'SAR' as any })],
      investments: [portfolioUSD()],
      investmentTransactions: [
        tx({ id: 'd-sar', type: 'deposit', total: 10000, currency: 'SAR' }),
        tx({ id: 'd-usd', type: 'deposit', total: 600, currency: 'USD' }),
        tx({ id: 'b-usd', type: 'buy', total: 1000, currency: 'USD', symbol: 'AAPL', quantity: 5, price: 200 }),
      ],
      sarPerUsd: 3.75,
    });

    // 600 USD consumed first, remaining 400 USD converted from SAR => 1,500 SAR.
    expect(map['inv-1'].SAR).toBeCloseTo(8500, 6);
    expect(map['inv-1'].USD).toBeCloseTo(0, 6);
  });

  it('falls back to account balance only when account has no investment ledger rows', () => {
    const map = computeAvailableCashByAccountMap({
      accounts: [invAccount({ balance: 2500, currency: 'SAR' as any })],
      investments: [portfolioUSD()],
      investmentTransactions: [],
    });

    expect(map['inv-1'].SAR).toBeCloseTo(2500, 6);
    expect(map['inv-1'].USD).toBeCloseTo(0, 6);
  });

  it('processes transactions in deterministic chronological order even when input is prepended', () => {
    const map = computeAvailableCashByAccountMap({
      accounts: [invAccount({ currency: 'SAR' as any })],
      investments: [portfolioUSD()],
      investmentTransactions: [
        // Newer row prepended first in app flow; buy should still execute after older deposit.
        tx({ id: 'new-buy', date: '2026-01-11', type: 'buy', total: 1000, currency: 'USD', symbol: 'AAPL', quantity: 10, price: 100, created_at: '2026-01-11T10:00:00Z' }),
        tx({ id: 'old-dep', date: '2026-01-10', type: 'deposit', total: 10000, currency: 'SAR', created_at: '2026-01-10T10:00:00Z' }),
      ],
      sarPerUsd: 3.75,
    });

    expect(map['inv-1'].SAR).toBeCloseTo(6250, 6);
    expect(map['inv-1'].USD).toBeCloseTo(0, 6);
  });
});
