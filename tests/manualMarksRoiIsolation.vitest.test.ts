/**
 * Manual-price portfolios must not invent deposit-based ROI when invested history is missing,
 * and must not change live-quote portfolio ROI math.
 */
import { describe, expect, it } from 'vitest';
import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
} from '../services/investmentKpiCore';
import { computePlatformCardMetrics, presentScopedInvestmentGrowth } from '../services/investmentPlatformCardMetrics';
import { presentHeadlineInvestmentGrowth } from '../services/extendedMetricsPresentation';
import { resolveScopedInvestmentCapitalSar } from '../services/investmentCapitalResolve';
import { holdingsAreManualMarksOnly } from '../utils/holdingValuation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAR_PER_USD = 3.75;
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function manualHolding(avgCost: number, qty: number, mark: number, id = 'hm1'): Holding {
  return {
    id,
    symbol: 'MANUAL-FUND',
    name: 'Manual fund',
    quantity: qty,
    avgCost,
    currentValue: mark * qty,
    currentPrice: mark,
    holdingType: 'manual_fund',
    zakahClass: 'Zakatable',
    realizedPnL: 0,
    assetClass: 'Fund',
  };
}

function liveHolding(avgCost: number, qty: number, mark: number, id = 'hl1', symbol = '2222.SR'): Holding {
  return {
    id,
    symbol,
    quantity: qty,
    avgCost,
    currentValue: mark * qty,
    zakahClass: 'Zakatable',
    realizedPnL: 0,
    assetClass: 'Stock',
  };
}

function fixture(args: {
  holdings: Holding[];
  txs?: InvestmentTransaction[];
  cashSar?: number;
  portfolioId?: string;
  accountId?: string;
}): FinancialData {
  const accountId = args.accountId ?? 'acc-manual';
  const portfolioId = args.portfolioId ?? 'pf-manual';
  const account = {
    id: accountId,
    name: 'Manual broker',
    type: 'Investment',
    balance: args.cashSar ?? 0,
    currency: 'SAR',
  } as Account;
  const portfolio: InvestmentPortfolio = {
    id: portfolioId,
    name: 'Manual book',
    accountId,
    currency: 'SAR',
    holdings: args.holdings,
  };
  return {
    accounts: [account],
    personalAccounts: [account],
    investments: [portfolio],
    personalInvestments: [portfolio],
    investmentTransactions: args.txs ?? [],
    transactions: [],
    budgets: [],
    goals: [],
    commodityHoldings: [],
    assets: [],
    liabilities: [],
    sukukPositions: [],
  } as unknown as FinancialData;
}

describe('manual marks ROI isolation', () => {
  it('detects manual-only open lots', () => {
    expect(holdingsAreManualMarksOnly([manualHolding(100, 10, 200)])).toBe(true);
    expect(holdingsAreManualMarksOnly([liveHolding(100, 10, 200)])).toBe(false);
    expect(holdingsAreManualMarksOnly([manualHolding(100, 10, 200), liveHolding(100, 5, 110)])).toBe(false);
    expect(holdingsAreManualMarksOnly([])).toBe(false);
  });

  it('manual marks without cost/buy history suppress deposit-only ROI', () => {
    const financial = fixture({
      holdings: [manualHolding(0, 1, 7089)],
      cashSar: 2884,
      txs: [
        {
          id: 'd1',
          type: 'deposit',
          total: 5000,
          date: '2026-07-01',
          portfolioId: 'pf-manual',
          accountId: 'acc-manual',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          currency: 'SAR',
        } as InvestmentTransaction,
      ],
    });
    const m = computePlatformCardMetrics({
      portfolios: financial.investments as InvestmentPortfolio[],
      transactions: financial.investmentTransactions as InvestmentTransaction[],
      accounts: financial.accounts as Account[],
      allInvestments: financial.investments as InvestmentPortfolio[],
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 2884, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
      datedFxData: financial,
    });
    expect(m.capitalSource).toBe('manual_marks');
    expect(m.roiSuppressed).toBe(true);
    expect(m.roi).toBe(0);
    expect(m.totalGainLossSAR).toBeCloseTo(0, 5);
    const presented = presentScopedInvestmentGrowth(m);
    expect(presented.roiDisplay).toBe('—');
    expect(presented.statusLabel).toMatch(/purchase cost/i);

    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      () => ({ SAR: 2884, USD: 0 }),
      {},
    );
    expect(headline.roiSuppressed).toBe(true);
    expect(headline.roi).toBe(0);
    expect(presentHeadlineInvestmentGrowth(headline)?.valueDisplay).toBe('—');
  });

  it('manual marks with typed cost but no buy ledger still suppress ROI (user example ~2845%)', () => {
    // Screenshot: cash 1,500 · growth 71,134 · ROI 2845.4% · net invested 2,500
    // PV ≈ 73,634; deposit 2,500; avgCost typed without buys → must not show deposit ROI.
    const positionsMark = 73_634 - 1_500;
    const financial = fixture({
      holdings: [manualHolding(1_000, 1, positionsMark)],
      cashSar: 1_500,
      txs: [
        {
          id: 'd1',
          type: 'deposit',
          total: 2_500,
          date: '2026-06-01',
          portfolioId: 'pf-manual',
          accountId: 'acc-manual',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          currency: 'SAR',
        } as InvestmentTransaction,
      ],
    });
    const m = computePlatformCardMetrics({
      portfolios: financial.investments as InvestmentPortfolio[],
      transactions: financial.investmentTransactions as InvestmentTransaction[],
      accounts: financial.accounts as Account[],
      allInvestments: financial.investments as InvestmentPortfolio[],
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 1_500, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
      datedFxData: financial,
    });
    expect(m.roiSuppressed).toBe(true);
    expect(m.roi).toBe(0);
    expect(m.dailyPnLSAR).toBe(0);
    expect(presentScopedInvestmentGrowth(m).roiDisplay).toBe('—');
    // Without the fix, growth/net would be ~2845%.
    expect(m.totalValueInSAR / 2_500).toBeGreaterThan(20);
  });

  it('manual marks with buy + cost still suppress when PV is absurd vs net (same 2845% shape)', () => {
    const positionsMark = 73_634 - 1_500;
    const financial = fixture({
      holdings: [manualHolding(1_000, 1, positionsMark)],
      cashSar: 1_500,
      txs: [
        {
          id: 'd1',
          type: 'deposit',
          total: 2_500,
          date: '2026-06-01',
          portfolioId: 'pf-manual',
          accountId: 'acc-manual',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          currency: 'SAR',
        } as InvestmentTransaction,
        {
          id: 'b1',
          type: 'buy',
          total: 1_000,
          date: '2026-06-02',
          portfolioId: 'pf-manual',
          accountId: 'acc-manual',
          symbol: 'MANUAL-FUND',
          quantity: 1,
          price: 1_000,
          currency: 'SAR',
        } as InvestmentTransaction,
      ],
    });
    const m = computePlatformCardMetrics({
      portfolios: financial.investments as InvestmentPortfolio[],
      transactions: financial.investmentTransactions as InvestmentTransaction[],
      accounts: financial.accounts as Account[],
      allInvestments: financial.investments as InvestmentPortfolio[],
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 1_500, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
      datedFxData: financial,
    });
    expect(m.capitalSource).toBe('manual_marks');
    expect(m.roiSuppressed).toBe(true);
    expect(presentScopedInvestmentGrowth(m).roiDisplay).toBe('—');
  });

  it('manual marks with cost floor ROI at cost+cash when buy history exists', () => {
    // Mark 200 vs cost 100; deposit only 50 would otherwise invent huge ROI — floor at cost+cash.
    const scoped = resolveScopedInvestmentCapitalSar({
      depositsRecordedSar: 50,
      withdrawnSar: 0,
      holdingsCostBasisSar: 10_000,
      cashSar: 0,
      buysSar: 10_000,
      manualMarksOnly: true,
    });
    expect(scoped.capitalSource).toBe('manual_marks');
    expect(scoped.netCapitalSar).toBeCloseTo(10_000, 5);
    expect(scoped.manualMarksInvestedHistoryIncomplete).toBe(false);
  });

  it('manual marks with typed avgCost but zero buys are incomplete', () => {
    const scoped = resolveScopedInvestmentCapitalSar({
      depositsRecordedSar: 2_500,
      withdrawnSar: 0,
      holdingsCostBasisSar: 1_000,
      cashSar: 1_500,
      buysSar: 0,
      manualMarksOnly: true,
    });
    expect(scoped.manualMarksInvestedHistoryIncomplete).toBe(true);
    expect(scoped.capitalSource).toBe('manual_marks');
  });

  it('live quote portfolios keep deposits − withdrawals ROI unchanged', () => {
    const financial = fixture({
      holdings: [liveHolding(100, 50, 160)],
      accountId: 'acc-live',
      portfolioId: 'pf-live',
      txs: [
        {
          id: 'd1',
          type: 'deposit',
          total: 5000,
          date: '2024-01-01',
          portfolioId: 'pf-live',
          accountId: 'acc-live',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          currency: 'SAR',
        } as InvestmentTransaction,
      ],
    });
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      () => ({ SAR: 0, USD: 0 }),
      { '2222.SR': { price: 160 } },
    );
    expect(headline.capitalSource).toBe('deposits');
    expect(headline.roiSuppressed).not.toBe(true);
    expect(headline.netCapitalSar).toBeCloseTo(5000, 5);
    expect(headline.totalExposureSar).toBeCloseTo(8000, 0);
    expect(headline.roi).toBeCloseTo(3000 / 5000, 8);
  });

  it('mixed live + incomplete manual does not invent free profit from manual marks', () => {
    const liveAcc = {
      id: 'acc-live',
      name: 'Live',
      type: 'Investment',
      balance: 0,
      currency: 'SAR',
    } as Account;
    const manAcc = {
      id: 'acc-man',
      name: 'Manual',
      type: 'Investment',
      balance: 0,
      currency: 'SAR',
    } as Account;
    const livePf: InvestmentPortfolio = {
      id: 'pf-live',
      name: 'Live',
      accountId: 'acc-live',
      currency: 'SAR',
      holdings: [liveHolding(100, 100, 110, 'hl', '2222.SR')],
    };
    const manPf: InvestmentPortfolio = {
      id: 'pf-man',
      name: 'Manual',
      accountId: 'acc-man',
      currency: 'SAR',
      holdings: [manualHolding(0, 1, 50_000, 'hm')],
    };
    const financial = {
      accounts: [liveAcc, manAcc],
      personalAccounts: [liveAcc, manAcc],
      investments: [livePf, manPf],
      personalInvestments: [livePf, manPf],
      investmentTransactions: [
        {
          id: 'd-live',
          type: 'deposit',
          total: 10_000,
          date: '2024-01-01',
          portfolioId: 'pf-live',
          accountId: 'acc-live',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          currency: 'SAR',
        },
        {
          id: 'd-man',
          type: 'deposit',
          total: 1000,
          date: '2024-06-01',
          portfolioId: 'pf-man',
          accountId: 'acc-man',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          currency: 'SAR',
        },
      ],
      transactions: [],
      budgets: [],
      goals: [],
      commodityHoldings: [],
      assets: [],
      liabilities: [],
      sukukPositions: [],
    } as unknown as FinancialData;

    const getCash = () => ({ SAR: 0, USD: 0 });
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(
      financial,
      SAR_PER_USD,
      getCash,
      { '2222.SR': { price: 110 } },
    );
    // Live: PV 11k on 10k net → +1k. Incomplete manual neutralized in platform rollup (net≈PV) → +0.
    expect(headline.platformsRollupSar).toBeGreaterThanOrEqual(11_000 + 50_000 - 1);
    expect(headline.netCapitalSar).toBeGreaterThanOrEqual(10_000 + 50_000 - 1);
    expect(headline.totalGainLossSar).toBeCloseTo(1000, 0);
    expect(headline.roiSuppressed).not.toBe(true);
    expect(Math.abs(headline.roi - 1000 / headline.netCapitalSar)).toBeLessThan(0.0001);
  });

  it('wiring: Investments + Dashboard + System Health surface manual_marks / suppressed ROI', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('roiSuppressed');
    expect(inv).toContain('Manual prices');
    expect(read('pages/SystemHealth.tsx')).toContain('manual_marks');
    expect(read('services/investmentCapitalResolve.ts')).toContain("manual_marks");
    expect(read('utils/holdingValuation.ts')).toContain('holdingsAreManualMarksOnly');
  });
});
