import { describe, expect, it } from 'vitest';
import {
  computeAccountsSetupPercent,
  computePreferencesConfigured,
  computeProfileSetupPercent,
  countActivePriceAlerts,
  countPortfolioDriftAttention,
  countTrackedSymbolsForFeed,
} from '../services/settingsSnapshot';
import type { FinancialData, Settings } from '../types';

describe('settingsSnapshot', () => {
  it('computeProfileSetupPercent counts four fields', () => {
    const s: Partial<Settings> = {
      riskProfile: 'Moderate',
      budgetThreshold: 90,
      driftThreshold: 5,
      goldPrice: 300,
    };
    expect(computeProfileSetupPercent(s)).toBe(100);
    expect(computeProfileSetupPercent({ ...s, goldPrice: 0 })).toBeLessThan(100);
  });

  it('computeAccountsSetupPercent is zero without accounts', () => {
    expect(computeAccountsSetupPercent({ accounts: [], transactions: [] } as FinancialData)).toBe(0);
  });

  it('countActivePriceAlerts respects status', () => {
    const data = {
      priceAlerts: [
        { id: '1', symbol: 'A', targetPrice: 1, status: 'active' as const, createdAt: '' },
        { id: '2', symbol: 'B', targetPrice: 2, status: 'triggered' as const, createdAt: '' },
      ],
    } as FinancialData;
    expect(countActivePriceAlerts(data)).toBe(1);
  });

  it('countPortfolioDriftAttention', () => {
    expect(countPortfolioDriftAttention(null, 5)).toBe(0);
    expect(countPortfolioDriftAttention(6, 5)).toBe(1);
    expect(countPortfolioDriftAttention(4, 5)).toBe(0);
  });

  it('countTrackedSymbolsForFeed dedupes and includes commodities', () => {
    const data = {
      investments: [{ holdings: [{ symbol: 'AAA' }, { symbol: 'aaa' }] }],
      watchlist: [{ symbol: 'AAA' }, { symbol: 'BBB' }],
      commodityHoldings: [{ symbol: 'XAU_TEST' }],
    } as unknown as FinancialData;
    expect(countTrackedSymbolsForFeed(data)).toBe(3);
  });

  it('computePreferencesConfigured', () => {
    const r = computePreferencesConfigured({
      riskProfile: 'Moderate',
      budgetThreshold: 90,
      driftThreshold: 5,
      goldPrice: 100,
      enableEmails: false,
    });
    expect(r.done).toBe(4);
    expect(r.total).toBe(4);
  });
});
