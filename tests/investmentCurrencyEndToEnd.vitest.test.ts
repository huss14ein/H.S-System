import { describe, it, expect } from 'vitest';
import type { Account, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { computePlatformCardMetrics, validatePlatformMetrics } from '../services/investmentPlatformCardMetrics';

const SAR_PER_USD = 3.75;

function account(id: string): Account {
  return { id, name: id, type: 'Investment', balance: 0 } as Account;
}

function portfolioUSD(accountId: string, holdings: Holding[]): InvestmentPortfolio {
  return { id: 'pf-usd', name: 'US', accountId, currency: 'USD', holdings } as InvestmentPortfolio;
}

function tx(partial: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'id' | 'type' | 'total'>): InvestmentTransaction {
  return {
    id: partial.id,
    type: partial.type,
    total: partial.total,
    accountId: partial.accountId ?? 'inv-1',
    date: partial.date ?? '2026-04-11',
    symbol: partial.symbol ?? 'CASH',
    quantity: partial.quantity ?? 0,
    price: partial.price ?? 0,
    currency: partial.currency,
  } as InvestmentTransaction;
}

describe('investment currency end-to-end metrics checks', () => {
  it('mixed SAR/USD deposits + USD holdings produce consistent SAR totals', () => {
    const holdings: Holding[] = [
      {
        id: 'h1',
        symbol: 'AAPL',
        quantity: 10,
        avgCost: 100,
        currentValue: 1100,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
      },
    ];
    const portfolios = [portfolioUSD('inv-1', holdings)];
    const transactions: InvestmentTransaction[] = [
      tx({ id: 'd-sar', type: 'deposit', total: 5000, currency: 'SAR' }),
      tx({ id: 'd-usd', type: 'deposit', total: 1000, currency: 'USD' }),
    ];

    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts: [account('inv-1')],
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 5000, USD: 200 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });

    const holdingsSar = 1100 * SAR_PER_USD;
    const cashSar = 5000 + 200 * SAR_PER_USD;
    const investedSar = 5000 + 1000 * SAR_PER_USD;

    expect(m.totalValueInSAR).toBeCloseTo(holdingsSar + cashSar, 5);
    expect(m.totalInvestedSAR).toBeCloseTo(investedSar, 5);
    expect(m.totalGainLossSAR).toBeCloseTo(m.totalValueInSAR - (m.totalInvestedSAR - m.totalWithdrawnSAR), 5);
  });

  it('legacy deposit without currency infers USD from single USD portfolio', () => {
    const portfolios = [portfolioUSD('inv-1', [])];
    const transactions: InvestmentTransaction[] = [tx({ id: 'legacy', type: 'deposit', total: 1000 })];

    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts: [account('inv-1')],
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 0, USD: 1000 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });

    expect(m.totalInvestedSAR).toBeCloseTo(1000 * SAR_PER_USD, 5);
    expect(m.totalValueInSAR).toBeCloseTo(1000 * SAR_PER_USD, 5);
    expect(m.totalGainLossSAR).toBeCloseTo(0, 5);
  });

  it('computed KPI payload passes strict reconciliation checks', () => {
    const portfolios = [portfolioUSD('inv-1', [])];
    const transactions: InvestmentTransaction[] = [tx({ id: 'd1', type: 'deposit', total: 1000, currency: 'USD' })];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts: [account('inv-1')],
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 0, USD: 1000 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });
    const check = validatePlatformMetrics(m, 'SAR', SAR_PER_USD);
    expect(check.ok).toBe(true);
    expect(check.issues).toHaveLength(0);
  });
});
