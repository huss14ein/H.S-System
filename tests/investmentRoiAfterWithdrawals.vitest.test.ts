/**
 * Headline ROI must measure growth on money still in the platform:
 * net invested = deposits − withdrawals (when deposit history exists).
 * Cost-basis + idle cash is a floor only when deposits were never recorded.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
  computePersonalInvestmentKpiBreakdown,
  formatInvestmentAgeLabel,
  investmentAgeDaysFromYmd,
  resolveHeadlinePlatformNetCapitalSar,
} from '../services/investmentKpiCore';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { computeCanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import {
  buildInvestmentsHeadlineKpiRow,
  headlineKpiMathIsConsistent,
} from '../services/extendedMetricsPresentation';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SAR_PER_USD = 3.75;
const PLATFORM_ID = 'platform-inv-1';

function baseAccount(): Account {
  return {
    id: PLATFORM_ID,
    name: 'Investment platform',
    type: 'Investment',
    balance: 0,
  } as Account;
}

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

function tx(
  partial: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'id' | 'type' | 'total'>,
): InvestmentTransaction {
  return {
    accountId: PLATFORM_ID,
    date: '2025-01-15',
    symbol: 'CASH',
    quantity: 0,
    price: 0,
    currency: 'SAR',
    ...partial,
  } as InvestmentTransaction;
}

function holding(avgCost: number, qty: number, mark: number): Holding {
  return {
    id: 'h1',
    symbol: '2222.SR',
    quantity: qty,
    avgCost,
    currentValue: mark * qty,
    zakahClass: 'Zakatable',
    realizedPnL: 0,
    assetClass: 'Stock',
  };
}

function dataWith(args: {
  holdings?: Holding[];
  transactions?: InvestmentTransaction[];
}): FinancialData {
  const portfolio = basePortfolio({ holdings: args.holdings ?? [] });
  const account = baseAccount();
  return {
    accounts: [account],
    personalAccounts: [account],
    investments: [portfolio],
    personalInvestments: [portfolio],
    investmentTransactions: args.transactions ?? [],
    transactions: [],
    budgets: [],
    goals: [],
    commodityHoldings: [],
    assets: [],
    liabilities: [],
    sukukPositions: [],
  } as unknown as FinancialData;
}

describe('headline ROI after withdrawals', () => {
  const getCashZero = () => ({ SAR: 0, USD: 0 });

  it('resolveHeadlinePlatformNetCapitalSar uses deposits − withdrawals, not cost-basis floor', () => {
    const depositsPath = resolveHeadlinePlatformNetCapitalSar({
      capitalSource: 'deposits',
      ledgerNetCapitalSar: 50_000,
      economicDeployedSar: 70_000,
    });
    expect(depositsPath.platformNetSar).toBe(50_000);
    expect(depositsPath.economicFloorApplied).toBe(false);

    const missingDeposits = resolveHeadlinePlatformNetCapitalSar({
      capitalSource: 'cost_basis_fallback',
      ledgerNetCapitalSar: 50_000,
      economicDeployedSar: 70_000,
    });
    expect(missingDeposits.platformNetSar).toBe(70_000);
    expect(missingDeposits.economicFloorApplied).toBe(true);
  });

  it('deposited 100k, withdrew 50k, remaining book 70k → ROI uses 50k net invested', () => {
    const financial = dataWith({
      holdings: [holding(700, 100, 800)],
      transactions: [
        tx({ id: 'd1', type: 'deposit', total: 100_000, date: '2024-08-13' }),
        tx({ id: 'w1', type: 'withdrawal', total: 50_000, date: '2025-06-01' }),
      ],
    });
    const getCash = () => ({ SAR: 0, USD: 0 });
    const prices = { '2222.SR': { price: 800 } };

    const breakdown = computePersonalInvestmentKpiBreakdown(financial, SAR_PER_USD, getCash);
    expect(breakdown.capitalSource).toBe('deposits');
    expect(breakdown.depositsRecordedSar).toBeCloseTo(100_000, 5);
    expect(breakdown.totalWithdrawnSar).toBeCloseTo(50_000, 5);
    expect(breakdown.netCapitalSar).toBeCloseTo(50_000, 5);
    expect(breakdown.holdingsCostBasisSar).toBeCloseTo(70_000, 5);
    expect(breakdown.firstCapitalDepositYmd).toBe('2024-08-13');

    const headline = computeHeadlinePersonalInvestmentRoiDecimal(financial, SAR_PER_USD, getCash, prices);
    expect(headline.economicFloorApplied).toBe(false);
    expect(headline.ledgerPlatformNetCapitalSar).toBeCloseTo(50_000, 5);
    expect(headline.netCapitalSar).toBeCloseTo(50_000, 5);
    expect(headline.totalExposureSar).toBeCloseTo(80_000, 0);
    expect(headline.totalGainLossSar).toBeCloseTo(30_000, 0);
    expect(headline.roi).toBeCloseTo(30_000 / 50_000, 8);
    expect(headline.principalFullyRecovered).toBe(false);
    expect(headlineKpiMathIsConsistent(headline)).toBe(true);

    const dashboard = computeDashboardKpiSnapshot(financial, SAR_PER_USD, getCash, prices);
    expect(dashboard?.roi).toBeCloseTo(headline.roi, 8);
    expect(dashboard?.headlineInvestmentExposure?.netCapitalSar).toBeCloseTo(50_000, 5);

    const metrics = computeCanonicalFinancialMetrics({
      data: financial,
      exchangeRate: SAR_PER_USD,
      getAvailableCashForAccount: getCash,
      simulatedPrices: prices,
    });
    const row = buildInvestmentsHeadlineKpiRow(metrics);
    expect(row).not.toBeNull();
    expect(row!.netInvestedSar).toBeCloseTo(50_000, 5);
    expect(row!.totalValue).toBeCloseTo(80_000, 0);
    expect(row!.totalGainLoss).toBeCloseTo(30_000, 0);
    expect(row!.roi).toBeCloseTo(60, 5);
    expect(row!.depositsRecordedSar).toBeCloseTo(100_000, 5);
    expect(row!.totalWithdrawnSar).toBeCloseTo(50_000, 5);
  });

  it('broker-cash reconcile withdrawal does not reduce economic net invested', () => {
    const financial = dataWith({
      holdings: [holding(100, 10, 100)],
      transactions: [
        tx({ id: 'd1', type: 'deposit', total: 10_000, date: '2025-01-01' }),
        tx({
          id: 'r1',
          type: 'withdrawal',
          total: 4_000,
          date: '2025-02-01',
          note: 'reconciliation:reconcile_balance:cash',
        }),
      ],
    });
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      () => ({ SAR: 0, USD: 0 }),
      { '2222.SR': { price: 100 } },
    );
    expect(headline.depositsRecordedSar).toBeCloseTo(10_000, 5);
    expect(headline.totalWithdrawnSar).toBeCloseTo(0, 5);
    expect(headline.netCapitalSar).toBeCloseTo(10_000, 5);
  });

  it('keeps cost-basis floor when deposit history is empty', () => {
    const financial = dataWith({
      holdings: [holding(700, 100, 800)],
      transactions: [],
    });
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      getCashZero,
      { '2222.SR': { price: 800 } },
    );
    expect(headline.capitalSource).toBe('cost_basis_fallback');
    expect(headline.economicFloorApplied).toBe(true);
    expect(headline.netCapitalSar).toBeCloseTo(70_000, 5);
    expect(headline.totalGainLossSar).toBeCloseTo(10_000, 0);
    expect(headline.roi).toBeCloseTo(10_000 / 70_000, 8);
  });

  it('principal fully withdrawn with leftover value is recovered profit, not 0% on a floored book', () => {
    const financial = dataWith({
      holdings: [holding(150, 100, 200)],
      transactions: [
        tx({ id: 'd1', type: 'deposit', total: 20_000, date: '2024-01-01' }),
        tx({ id: 'w1', type: 'withdrawal', total: 20_000, date: '2025-12-01' }),
      ],
    });
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      getCashZero,
      { '2222.SR': { price: 200 } },
    );
    expect(headline.capitalSource).toBe('deposits');
    expect(headline.netCapitalSar).toBe(0);
    expect(headline.principalFullyRecovered).toBe(true);
    expect(headline.totalExposureSar).toBeCloseTo(20_000, 0);
    expect(headline.totalGainLossSar).toBeCloseTo(20_000, 0);
    expect(headlineKpiMathIsConsistent(headline)).toBe(true);
  });

  it('formats investment age from first deposit', () => {
    expect(investmentAgeDaysFromYmd('2026-08-13', '2026-08-13')).toBe(0);
    expect(formatInvestmentAgeLabel(0)).toBe('Started today');
    expect(formatInvestmentAgeLabel(1)).toBe('1 day invested');
    expect(formatInvestmentAgeLabel(45)).toBe('1 month invested');
    expect(formatInvestmentAgeLabel(400)).toBe('1y 1mo invested');
  });
});

describe('ROI-after-withdrawals surface wiring', () => {
  it('Investments hub shows net invested, present value, growth, and time invested', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('Net invested');
    expect(page).toContain('Present value');
    expect(page).toContain('Time invested');
    expect(page).toContain('depositsRecordedSar');
    expect(page).toContain('netInvestedSar');
    expect(page).not.toContain('larger of (deposits − withdrawals)');
  });

  it('headline helper does not max deposits-path capital with cost basis', () => {
    const core = read('services/investmentKpiCore.ts');
    expect(core).toContain('resolveHeadlinePlatformNetCapitalSar');
    expect(core).toContain("args.capitalSource === 'deposits'");
    expect(core).not.toMatch(
      /platformNetForHeadline = Math\.max\(breakdown\.netCapitalSar, economicDeployedSar\)/,
    );
  });

  it('Dashboard ROI card explains withdrawals', () => {
    expect(read('pages/Dashboard.tsx')).toContain('net invested after withdrawals');
    expect(read('pages/Dashboard.tsx')).toContain('commodities + Sukuk');
  });
});
