import { describe, it, expect } from 'vitest';
import type { Account, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { computeAvailableCashByAccountMap } from '../services/investmentCashLedger';

function invAccount(overrides: Partial<Account> = {}): Account {
  return { id: 'inv-1', name: 'Broker', type: 'Investment', balance: 0, ...overrides } as Account;
}

function portfolioUSD(): InvestmentPortfolio {
  return { id: 'pf-1', name: 'US', accountId: 'inv-1', currency: 'USD', holdings: [] } as InvestmentPortfolio;
}

function tx(partial: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'id' | 'type' | 'total'>): InvestmentTransaction {
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
  } as InvestmentTransaction;
}

describe('computeAvailableCashByAccountMap', () => {
  it('keeps USD trade deductions in USD bucket (does not deduct SAR)', () => {
    const map = computeAvailableCashByAccountMap({
      accounts: [invAccount({ currency: 'SAR' as any })],
      investments: [portfolioUSD()],
      investmentTransactions: [
        tx({ id: 'd-sar', type: 'deposit', total: 10000, currency: 'SAR' }),
        tx({ id: 'b-usd', type: 'buy', total: 1000, currency: 'USD', symbol: 'AAPL', quantity: 5, price: 200 }),
      ],
    });

    expect(map['inv-1'].SAR).toBeCloseTo(10000, 6);
    expect(map['inv-1'].USD).toBeCloseTo(-1000, 6);
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
});
