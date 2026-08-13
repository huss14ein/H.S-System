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
  safeCapitalDepositYmd,
} from '../services/investmentKpiCore';
import {
  computePlatformCardMetrics,
  computePortfolioMetricsBundle,
  presentScopedInvestmentGrowth,
} from '../services/investmentPlatformCardMetrics';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { computeCanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import {
  buildInvestmentsHeadlineKpiRow,
  headlineKpiMathIsConsistent,
  presentHeadlineInvestmentGrowth,
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

  it('keeps cost-basis capital when deposit history is empty', () => {
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
    expect(headline.netCapitalSar).toBeCloseTo(70_000, 5);
    expect(headline.netCapitalSar).toBeGreaterThanOrEqual(headline.economicDeployedPlatformSar - 1e-9);
    expect(headline.totalGainLossSar).toBeCloseTo(10_000, 0);
    expect(headline.roi).toBeCloseTo(10_000 / 70_000, 8);
  });

  it('floors incomplete buy history (no deposits) at cost basis + cash', () => {
    const financial = dataWith({
      holdings: [holding(700, 100, 800)],
      transactions: [tx({ id: 'b1', type: 'buy', symbol: '2222.SR', quantity: 100, price: 200, total: 20_000 })],
    });
    const breakdown = computePersonalInvestmentKpiBreakdown(financial, SAR_PER_USD, getCashZero);
    expect(breakdown.capitalSource).toBe('ledger_inferred');
    expect(breakdown.netCapitalSar).toBeCloseTo(20_000, 5);

    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      getCashZero,
      { '2222.SR': { price: 800 } },
    );
    expect(headline.economicFloorApplied).toBe(true);
    expect(headline.netCapitalSar).toBeCloseTo(70_000, 5);
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

  it('rejects non-calendar deposit dates (XSS / injection)', () => {
    expect(safeCapitalDepositYmd('2024-01-01<script>')).toBe('2024-01-01');
    expect(safeCapitalDepositYmd('javascript:alert(1)')).toBeNull();
    expect(safeCapitalDepositYmd('2024-1-1')).toBeNull();
    expect(safeCapitalDepositYmd('<img src=x onerror=alert(1)>')).toBeNull();
  });

  it('treats leftover net invested under 1 SAR as principal recovered', () => {
    const financial = dataWith({
      holdings: [holding(150, 100, 200)],
      transactions: [
        tx({ id: 'd1', type: 'deposit', total: 20_000, date: '2024-01-01' }),
        tx({ id: 'w1', type: 'withdrawal', total: 19_999.6, date: '2025-12-01' }),
      ],
    });
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      getCashZero,
      { '2222.SR': { price: 200 } },
    );
    expect(headline.principalFullyRecovered).toBe(true);
    expect(headline.roi).toBe(0);
    const presented = presentHeadlineInvestmentGrowth(headline);
    expect(presented?.valueDisplay).toBe('Principal recovered');
    expect(presented?.firstCapitalDepositYmd).toBe('2024-01-01');
  });
});

describe('platform and portfolio ROI after withdrawals', () => {
  it('platform card uses deposits − withdrawals, growth amount, and first-deposit age', () => {
    const portfolio = basePortfolio({ holdings: [holding(700, 100, 800)] });
    const account = baseAccount();
    const m = computePlatformCardMetrics({
      portfolios: [portfolio],
      transactions: [
        tx({ id: 'd1', type: 'deposit', total: 100_000, date: '2024-08-13' }),
        tx({ id: 'w1', type: 'withdrawal', total: 50_000, date: '2025-06-01' }),
      ],
      accounts: [account],
      allInvestments: [portfolio],
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices: { '2222.SR': { price: 800 } },
      platformCurrency: 'SAR',
    });
    expect(m.totalInvestedSAR).toBeCloseTo(100_000, 5);
    expect(m.totalWithdrawnSAR).toBeCloseTo(50_000, 5);
    expect(m.netCapitalSAR).toBeCloseTo(50_000, 5);
    expect(m.totalValueInSAR).toBeCloseTo(80_000, 0);
    expect(m.totalGainLossSAR).toBeCloseTo(30_000, 0);
    expect(m.roi).toBeCloseTo(60, 5);
    expect(m.firstCapitalDepositYmd).toBe('2024-08-13');
    expect(m.investmentAgeDays).toBe(investmentAgeDaysFromYmd('2024-08-13'));
    const presented = presentScopedInvestmentGrowth(m);
    expect(presented.statusLabel).toBe('Growing');
    expect(presented.growthSar).toBeCloseTo(30_000, 0);
    expect(presented.ageLabel).toBe(formatInvestmentAgeLabel(m.investmentAgeDays));
  });

  it('each of two portfolios uses deposits − withdrawals (not qty × avg cost)', () => {
    const p1 = basePortfolio({
      id: 'pf-a',
      name: 'A',
      holdings: [holding(100, 100, 160)],
    });
    const p2: InvestmentPortfolio = {
      ...basePortfolio({ id: 'pf-b', name: 'B' }),
      holdings: [
        {
          id: 'h2',
          symbol: '1120.SR',
          quantity: 50,
          avgCost: 200,
          currentValue: 12_000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          assetClass: 'Stock',
        },
      ],
    };
    const account = baseAccount();
    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: [p1, p2],
      transactions: [
        tx({ id: 'd-a', type: 'deposit', total: 20_000, date: '2024-01-01', portfolioId: 'pf-a' }),
        tx({ id: 'w-a', type: 'withdrawal', total: 8_000, date: '2025-01-01', portfolioId: 'pf-a' }),
        tx({ id: 'd-b', type: 'deposit', total: 10_000, date: '2024-06-01', portfolioId: 'pf-b' }),
      ],
      accounts: [account],
      allInvestments: [p1, p2],
      sarPerUsd: SAR_PER_USD,
      simulatedPrices: { '2222.SR': { price: 160 }, '1120.SR': { price: 240 } },
      accountAvailableCashByCurrency: { SAR: 0, USD: 0 },
    });
    const a = bundle.metricsByPortfolioId.get('pf-a')!;
    const b = bundle.metricsByPortfolioId.get('pf-b')!;
    expect(a.netCapitalSAR).toBeCloseTo(12_000, 5);
    expect(a.totalValueInSAR).toBeCloseTo(16_000, 0);
    expect(a.totalGainLossSAR).toBeCloseTo(4_000, 0);
    expect(a.roi).toBeCloseTo((4_000 / 12_000) * 100, 5);
    expect(a.firstCapitalDepositYmd).toBe('2024-01-01');
    expect(b.netCapitalSAR).toBeCloseTo(10_000, 5);
    expect(b.totalValueInSAR).toBeCloseTo(12_000, 0);
    expect(b.totalGainLossSAR).toBeCloseTo(2_000, 0);
    expect(b.roi).toBeCloseTo(20, 5);
    expect(presentScopedInvestmentGrowth(a).statusLabel).toBe('Growing');
    expect(presentScopedInvestmentGrowth(b).statusLabel).toBe('Growing');
  });

  it('idle cash share is not counted as a loss on a multi-portfolio platform', () => {
    const p1 = basePortfolio({
      id: 'pf-a',
      holdings: [{ ...holding(10, 40, 10), id: 'ha', symbol: 'AAA.SR', currentValue: 400 }],
    });
    const p2 = basePortfolio({
      id: 'pf-b',
      holdings: [{ ...holding(10, 40, 10), id: 'hb', symbol: 'BBB.SR', currentValue: 400 }],
    });
    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: [p1, p2],
      transactions: [tx({ id: 'd1', type: 'deposit', total: 1_000, date: '2025-01-01' })],
      accounts: [baseAccount()],
      allInvestments: [p1, p2],
      sarPerUsd: SAR_PER_USD,
      simulatedPrices: {},
      accountAvailableCashByCurrency: { SAR: 200, USD: 0 },
    });
    const a = bundle.metricsByPortfolioId.get('pf-a')!;
    const b = bundle.metricsByPortfolioId.get('pf-b')!;
    expect(a.netCapitalSAR).toBeCloseTo(500, 5);
    expect(b.netCapitalSAR).toBeCloseTo(500, 5);
    expect(a.totalValueInSAR).toBeCloseTo(500, 5);
    expect(b.totalValueInSAR).toBeCloseTo(500, 5);
    expect(a.totalGainLossSAR).toBeCloseTo(0, 5);
    expect(b.totalGainLossSAR).toBeCloseTo(0, 5);
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
    expect(page).toContain('presentScopedInvestmentGrowth');
    expect(page).toContain('platformGrowth.ageLabel');
    expect(page).toContain('portfolioGrowth');
    expect(page).not.toContain('Unrealized P/L divided by total cost basis');
    expect(page).not.toContain('use position vs average cost like the holdings table');
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
    expect(read('pages/Dashboard.tsx')).toContain('presentHeadlineInvestmentGrowth');
  });

  it('every ROI surface uses the shared growth presenter (no ad-hoc 0% on recovered principal)', () => {
    const surfaces: Array<[string, string[]]> = [
      ['pages/Dashboard.tsx', ['presentHeadlineInvestmentGrowth']],
      ['pages/Analysis.tsx', ['presentHeadlineInvestmentGrowth']],
      ['pages/WealthAnalytics.tsx', ['presentHeadlineInvestmentGrowth']],
      ['components/analytics/ExecutiveKpiGrid.tsx', ['presentHeadlineInvestmentGrowth']],
      ['services/wealthAnalyticsReportModel.ts', ['presentHeadlineInvestmentGrowth']],
      ['services/aiPersonalWealthGrounding.ts', ['presentHeadlineInvestmentGrowth', 'net invested']],
      ['services/geminiService.ts', ['Net invested after withdrawals', 'Principal fully recovered']],
      ['services/metricPassportModel.ts', ['Net invested after withdrawals']],
      ['services/reportingEngine.ts', ['Net invested after withdrawals']],
      ['pages/Investments.tsx', ['presentHeadlineInvestmentGrowth', 'principalFullyRecovered']],
      ['services/reviewPack.ts', ['presentHeadlineInvestmentGrowth', 'Net invested after withdrawals']],
      ['supabase/functions/send-weekly-digest/index.ts', ['computeWeeklyDigestInvestmentGrowth', 'Investment growth']],
      ['components/analytics/WealthAnalyticsHero.tsx', ['roiStatusLabel']],
    ];
    for (const [path, patterns] of surfaces) {
      const src = read(path);
      for (const p of patterns) {
        expect(src, `${path} missing ${p}`).toContain(p);
      }
    }
  });
});
