import { describe, it, expect } from 'vitest';
import type { Account, FinancialData, InvestmentPortfolio } from '../types';
import {
  inferInvestmentTransactionCurrency,
  ledgerCurrencyCashToInvestment,
  ledgerCurrencyInvestmentToCash,
  resolveCashAccountCurrency,
} from '../utils/investmentLedgerCurrency';

function baseData(overrides?: Partial<FinancialData>): FinancialData {
  return {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [], recurringTransactions: [],
    investments: [], investmentTransactions: [], budgets: [], commodityHoldings: [], watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
    zakatPayments: [], priceAlerts: [], plannedTrades: [], notifications: [],
    investmentPlan: {
      monthlyBudget: 0,
      budgetCurrency: 'SAR',
      executionCurrency: 'USD',
      fxRateSource: 'GoogleFinance:CURRENCY:SARUSD',
      coreAllocation: 0.7,
      upsideAllocation: 0.3,
      minimumUpsidePercentage: 25,
      stale_days: 5,
      min_coverage_threshold: 0.8,
      redirect_policy: 'priority',
      target_provider: 'Finnhub',
      corePortfolio: [],
      upsideSleeve: [],
      brokerConstraints: { allowFractionalShares: false, minimumOrderSize: 1, roundingRule: 'round', leftoverCashRule: 'hold' },
    },
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    allTransactions: [],
    allBudgets: [],
    wealthUltraConfig: {
      fxRate: 3.75, cashReservePct: 10, maxPerTickerPct: 15,
      riskWeightLow: 1, riskWeightMed: 1, riskWeightHigh: 1, riskWeightSpec: 1,
      defaultTarget1Pct: 5, defaultTarget2Pct: 10, defaultTrailingPct: 5,
    },
    budgetRequests: [],
    ...overrides,
  } as FinancialData;
}

describe('investment ledger currency helpers', () => {
  it('uses cash account currency for cash -> investment transfer', () => {
    const fromCash = { id: 'cash-1', type: 'Checking', currency: 'USD' } as Account;
    expect(ledgerCurrencyCashToInvestment(fromCash, baseData())).toBe('USD');
  });

  it('uses destination cash currency for investment -> cash transfer', () => {
    const toCash = { id: 'cash-2', type: 'Savings', currency: 'SAR' } as Account;
    expect(ledgerCurrencyInvestmentToCash(toCash, baseData())).toBe('SAR');
  });

  it('falls back to plan budget currency, then SAR when account currency missing', () => {
    const cash = { id: 'cash-3', type: 'Checking' } as Account;
    expect(resolveCashAccountCurrency(cash, baseData({ investmentPlan: { budgetCurrency: 'USD' } as any }))).toBe('USD');
    expect(resolveCashAccountCurrency(cash, null)).toBe('SAR');
  });

  it('infers missing tx currency from single-currency account portfolios', () => {
    const accounts = [{ id: 'inv-1', type: 'Investment' } as Account];
    const investments = [
      { id: 'p1', accountId: 'inv-1', currency: 'USD', holdings: [] } as InvestmentPortfolio,
      { id: 'p2', accountId: 'inv-1', currency: 'USD', holdings: [] } as InvestmentPortfolio,
    ];
    const inferred = inferInvestmentTransactionCurrency({ accountId: 'inv-1' } as any, accounts, investments);
    expect(inferred).toBe('USD');
  });
});
