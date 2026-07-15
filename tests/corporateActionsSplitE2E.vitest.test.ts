/**
 * Stock split / reverse split — system-wide E2E behavioral tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyCorporateAction,
  recalculateCostBasisAfterAction,
  splitProducesFraction,
} from '../services/corporateActions';
import {
  buildCorporateActionEventPayload,
  corporateActionFromRow,
  replayPortfolioHoldingsFromEvents,
  validateCorporateActionApplyPrerequisites,
} from '../services/corporateActionApply';
import { previewCorporateActionWizard, createInitialWizardState } from '../services/corporateActionWizardModel';
import { computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import { buildHoldingsDividendReconciliationReport } from '../services/holdingsDividendReconciliation';
import { buildFinancialDataForWeeklyDigest } from '../services/digestFinancialData';
import { resolveExpectedAnnualSar } from '../services/dividendTrackerModel';
import { scaleQuoteRowForSplit } from '../services/corporateActionQuoteAdjust';
import { reconcileHoldingsWithCorporateActionsSync } from '../services/reconciliationEngine';
import { rebuildCostLotsFromEvents } from '../services/portfolioLotReplayEngine';
import { computePersonalHeadlineNetWorthSar } from '../services/personalNetWorth';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { computeHeadlinePersonalInvestmentRoiDecimal } from '../services/investmentKpiCore';
import { buildHeadlineInvestmentAllocationSlices } from '../services/headlineInvestmentAllocation';
import { summarizeZakatableInvestmentsForZakat } from '../services/zakatInvestmentValuation';
import { buildAiPersonalWealthGrounding } from '../services/aiPersonalWealthGrounding';
import type { CorporateActionEvent, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const fx = 3.75;
const getCash = () => ({ SAR: 5000, USD: 0 });

function basePortfolio(holdings: InvestmentPortfolio['holdings']): InvestmentPortfolio {
  return {
    id: 'pf1',
    name: 'Main',
    accountId: 'inv',
    currency: 'SAR',
    holdings,
  };
}

function financialDataWithHolding(
  holding: NonNullable<InvestmentPortfolio['holdings']>[number],
): FinancialData {
  return {
    accounts: [
      { id: 'chk', name: 'Checking', type: 'Checking', balance: 10000, currency: 'SAR' },
      { id: 'inv', name: 'Broker', type: 'Investment', balance: 5000, currency: 'SAR' },
    ],
    assets: [],
    liabilities: [],
    commodityHoldings: [],
    sukukPositions: [],
    investments: [basePortfolio([holding])],
    transactions: [],
    budgets: [],
    settings: {} as FinancialData['settings'],
    goals: [],
    watchlist: [],
    zakatPayments: [],
    priceAlerts: [],
    plannedTrades: [],
    investmentPlan: {} as FinancialData['investmentPlan'],
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    notifications: [],
    investmentTransactions: [],
    corporateActionEvents: [],
    investmentCostLots: [],
  } as unknown as FinancialData;
}

describe('corporateActionsSplitE2E', () => {
  it('2:1 stock split preserves cost basis invariant', () => {
    const applied = applyCorporateAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    expect(applied.quantity).toBeCloseTo(20, 4);
    expect(applied.avgCost).toBeCloseTo(50, 4);
    expect(applied.quantity * applied.avgCost).toBeCloseTo(1000, 2);
  });

  it('1:10 reverse split preserves cost basis invariant', () => {
    const applied = applyCorporateAction({
      action: { type: 'reverse_stock_split', ratioNumerator: 1, ratioDenominator: 10 },
      holding: { quantity: 100, avgCost: 10 },
    });
    expect(applied.quantity).toBeCloseTo(10, 4);
    expect(applied.avgCost).toBeCloseTo(100, 4);
    expect(applied.quantity * applied.avgCost).toBeCloseTo(1000, 2);
  });

  it('reverse split with fractional cash deposits cash-in-lieu only', () => {
    const applied = applyCorporateAction({
      action: {
        type: 'reverse_stock_split',
        ratioNumerator: 1,
        ratioDenominator: 10,
        cashInLieuPrice: 50,
      },
      holding: { quantity: 15, avgCost: 10 },
    });
    expect(applied.quantity).toBeCloseTo(1, 4);
    expect(applied.avgCost).toBeCloseTo(100, 4);
    expect(applied.cashInLieu).toBeCloseTo(25, 4);
    expect(applied.quantity * applied.avgCost).toBeCloseTo(100, 2);
  });

  it('cashInLieuPrice round-trips through event payload', () => {
    const payload = buildCorporateActionEventPayload({
      portfolioId: 'pf1',
      symbol: 'AAPL',
      executionDate: '2026-06-01',
      action: {
        type: 'reverse_stock_split',
        ratioNumerator: 1,
        ratioDenominator: 10,
        cashInLieuPrice: 42.5,
      },
    });
    const restored = corporateActionFromRow({
      id: 'x',
      portfolio_id: 'pf1',
      action_type: 'reverse_stock_split',
      symbol: 'AAPL',
      execution_date: '2026-06-01',
      ratio_numerator: payload.ratio_numerator,
      ratio_denominator: payload.ratio_denominator,
      price_per_share: payload.price_per_share,
      metadata: payload.metadata ?? {},
      idempotency_key: payload.idempotency_key,
    });
    expect(restored.cashInLieuPrice).toBeCloseTo(42.5, 4);
  });

  it('FIFO sell after split uses halved cost per share', async () => {
    const buyTx: InvestmentTransaction = {
      id: 't1',
      portfolioId: 'pf1',
      accountId: 'inv',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'AAPL',
      quantity: 10,
      price: 100,
      total: 1000,
    };
    const splitEv = {
      id: 'ca1',
      executionDate: '2026-06-01',
      symbol: 'AAPL',
      action: { type: 'stock_split' as const, ratioNumerator: 2, ratioDenominator: 1 },
    };
    const sellTx: InvestmentTransaction = {
      id: 't2',
      portfolioId: 'pf1',
      accountId: 'inv',
      date: '2026-07-01',
      type: 'sell',
      symbol: 'AAPL',
      quantity: 5,
      price: 60,
      total: 300,
    };
    const lots = await rebuildCostLotsFromEvents({
      portfolioId: 'pf1',
      transactions: [buyTx, sellTx],
      corporateActions: [splitEv],
    });
    const aaplLots = lots.lots.filter((l) => l.symbol === 'AAPL');
    expect(aaplLots.some((l) => Math.abs(l.costPerShare - 50) < 0.01)).toBe(true);
  });

  it('replay after 2:1 split doubles quantity without double-replay seed bug', async () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 20,
        avgCost: 50,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const buyTx: InvestmentTransaction = {
      id: 't1',
      portfolioId: 'pf1',
      accountId: 'inv',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'AAPL',
      quantity: 10,
      price: 100,
      total: 1000,
    };
    const splitEvent: CorporateActionEvent = {
      id: 'ca1',
      portfolioId: 'pf1',
      actionType: 'stock_split',
      symbol: 'AAPL',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'split-1',
      status: 'applied',
    };
    const replayed = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [buyTx],
      corporateActionEvents: [splitEvent],
    });
    expect(replayed.get('AAPL')?.quantity).toBeCloseTo(20, 4);
    expect(replayed.get('AAPL')?.avgCost).toBeCloseTo(50, 4);
  });

  it('manual-only portfolio first split uses as_stored baseline', async () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        avgCost: 100,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const splitEvent: CorporateActionEvent = {
      id: 'ca1',
      portfolioId: 'pf1',
      actionType: 'stock_split',
      symbol: 'AAPL',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'split-1',
      status: 'applied',
    };
    const first = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [],
      corporateActionEvents: [splitEvent],
      holdingsBaselineMode: 'as_stored',
    });
    expect(first.get('AAPL')?.quantity).toBeCloseTo(20, 4);
    expect(first.get('AAPL')?.avgCost).toBeCloseTo(50, 4);
  });

  it('manual-only portfolio re-sync does not double-apply split', async () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 20,
        avgCost: 50,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const splitEvent: CorporateActionEvent = {
      id: 'ca1',
      portfolioId: 'pf1',
      actionType: 'stock_split',
      symbol: 'AAPL',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'split-1',
      status: 'applied',
    };
    const resync = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [],
      corporateActionEvents: [splitEvent],
      holdingsBaselineMode: 'replay_derived',
    });
    expect(resync.get('AAPL')?.quantity).toBeCloseTo(20, 4);
    expect(resync.get('AAPL')?.avgCost).toBeCloseTo(50, 4);
  });

  it('headline net worth stable when quotes scale with 2:1 split', () => {
    const holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const preQuotes = { AAPL: { price: 100, change: 0, changePercent: 0 } };
    const data = financialDataWithHolding(holding);
    const pre = computePersonalHeadlineNetWorthSar(data, fx, {
      getAvailableCashForAccount: getCash,
      simulatedPrices: preQuotes,
    });

    const split = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    const postHolding = { ...holding, quantity: split.quantity, avgCost: split.avgCost, currentValue: 1000 };
    const postQuotes = { AAPL: scaleQuoteRowForSplit(preQuotes.AAPL, 2) };
    const postData = financialDataWithHolding(postHolding);
    const post = computePersonalHeadlineNetWorthSar(postData, fx, {
      getAvailableCashForAccount: getCash,
      simulatedPrices: postQuotes,
    });

    expect(post.netWorth).toBeCloseTo(pre.netWorth, 0);
  });

  it('dashboard KPI and investment ROI stable across split', () => {
    const holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const preQuotes = { AAPL: { price: 100 } };
    const data = financialDataWithHolding(holding);
    const preKpi = computeDashboardKpiSnapshot(data, fx, getCash, preQuotes);
    const preRoi = computeHeadlinePersonalInvestmentRoiDecimal(data, fx, getCash, preQuotes);

    const split = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    const postData = financialDataWithHolding(
      { ...holding, quantity: split.quantity, avgCost: split.avgCost, currentValue: 1000 },
    );
    const postQuotes = { AAPL: { price: 50 } };
    const postKpi = computeDashboardKpiSnapshot(postData, fx, getCash, postQuotes);
    const postRoi = computeHeadlinePersonalInvestmentRoiDecimal(postData, fx, getCash, postQuotes);

    expect(postKpi?.netWorth).toBeCloseTo(preKpi?.netWorth ?? 0, 0);
    expect(postRoi.totalExposureSar).toBeCloseTo(preRoi.totalExposureSar, 0);
    expect(postRoi.roi).toBeCloseTo(preRoi.roi, 4);
  });

  it('allocation slices and wealth summary investment bucket stable', () => {
    const holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const preQuotes = { AAPL: { price: 100 } };
    const data = financialDataWithHolding(holding);
    const preRoi = computeHeadlinePersonalInvestmentRoiDecimal(data, fx, getCash, preQuotes);
    const preAlloc = buildHeadlineInvestmentAllocationSlices(
      data,
      preRoi,
      fx,
      preRoi.platformsRollupSar,
      preQuotes,
    );

    const split = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    const postQuotes = { AAPL: { price: 50 } };
    const postData = financialDataWithHolding(
      { ...holding, quantity: split.quantity, avgCost: split.avgCost, currentValue: 1000 },
    );
    const postRoi = computeHeadlinePersonalInvestmentRoiDecimal(postData, fx, getCash, postQuotes);
    const postAlloc = buildHeadlineInvestmentAllocationSlices(
      postData,
      postRoi,
      fx,
      postRoi.platformsRollupSar,
      postQuotes,
    );

    expect(postRoi.totalExposureSar).toBeCloseTo(preRoi.totalExposureSar, 0);
    expect(postAlloc.totalSar).toBeCloseTo(preAlloc.totalSar, 0);
  });

  it('weekly digest source holdings reflect post-split quantities', () => {
    const digest = buildFinancialDataForWeeklyDigest({
      accountsRaw: [{ id: 'inv', name: 'Broker', type: 'Investment', balance: 5000, currency: 'SAR' }],
      portfoliosRaw: [
        {
          id: 'pf1',
          name: 'Main',
          account_id: 'inv',
          currency: 'SAR',
          holdings: [
            {
              id: 'h1',
              symbol: 'AAPL',
              quantity: 20,
              avg_cost: 50,
              current_value: 1000,
              zakah_class: 'Zakatable',
            },
          ],
        },
      ],
      assetsRaw: [],
      liabilitiesRaw: [],
      commodityHoldingsRaw: [],
      investmentTransactionsRaw: [],
      wealthUltraUserRow: null,
      wealthUltraGlobalRow: null,
    });
    const row = digest.investments?.[0]?.holdings?.find((h) => h.symbol === 'AAPL');
    expect(row?.quantity).toBeCloseTo(20, 4);
    expect(row?.avgCost).toBeCloseTo(50, 4);
  });

  it('dividend expected annual scales with post-split quantity (per-share)', () => {
    const market = { dividendPerShareAnnual: 2, dividendCashCurrency: 'USD' as const };
    const preHolding = {
      id: 'h1',
      symbol: 'AAPL',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const postHolding = { ...preHolding, quantity: 20, avgCost: 50 };
    const pre = resolveExpectedAnnualSar({
      holding: preHolding,
      bookCurrency: 'USD',
      sarPerUsd: fx,
      market,
    });
    const post = resolveExpectedAnnualSar({
      holding: postHolding,
      bookCurrency: 'USD',
      sarPerUsd: fx,
      market,
    });
    expect(post.annualSar).toBeCloseTo(pre.annualSar * 2, 0);
  });

  it('wizard preview preserves cost basis invariant row', async () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        avgCost: 100,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const preview = await previewCorporateActionWizard({
      state: createInitialWizardState({
        portfolioId: 'pf1',
        symbol: 'AAPL',
        actionType: 'stock_split',
        ratioNumerator: '2',
        ratioDenominator: '1',
        step: 'preview',
      }),
      portfolio,
      transactions: [],
      corporateActionEvents: [],
    });
    expect(preview.errors).toHaveLength(0);
    expect(preview.holding?.beforeCostBasis).toBeCloseTo(1000, 2);
    expect(preview.holding?.afterCostBasis).toBeCloseTo(1000, 2);
  });

  it('validateCorporateActionApplyPrerequisites blocks second manual corporate action', () => {
    const events: CorporateActionEvent[] = [
      {
        id: 'ca1',
        portfolioId: 'pf1',
        actionType: 'stock_split',
        symbol: 'AAPL',
        executionDate: '2026-06-01',
        ratioNumerator: 2,
        ratioDenominator: 1,
        idempotencyKey: 'k1',
        status: 'applied',
      },
    ];
    const blocked = validateCorporateActionApplyPrerequisites({
      portfolioId: 'pf1',
      symbol: 'AAPL',
      transactions: [],
      corporateActionEvents: events,
    });
    expect(blocked.valid).toBe(false);
  });

  it('preview replay floors fractional reverse split when cashInLieuPrice set', async () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 15,
        avgCost: 10,
        currentValue: 150,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const buyTx: InvestmentTransaction = {
      id: 't1',
      portfolioId: 'pf1',
      accountId: 'inv',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'AAPL',
      quantity: 15,
      price: 10,
      total: 150,
    };
    const preview = await previewCorporateActionWizard({
      state: createInitialWizardState({
        portfolioId: 'pf1',
        symbol: 'AAPL',
        actionType: 'reverse_stock_split',
        ratioNumerator: '1',
        ratioDenominator: '10',
        cashInLieuPrice: '50',
        step: 'preview',
      }),
      portfolio,
      transactions: [buyTx],
      corporateActionEvents: [],
    });
    expect(preview.errors).toHaveLength(0);
    expect(preview.holding?.afterQuantity).toBeCloseTo(1, 4);
    expect(preview.holding?.cashInLieu).toBeCloseTo(25, 4);
    const replayAapl = preview.replaySymbols.find((r) => r.symbol === 'AAPL');
    expect(replayAapl?.quantity).toBeCloseTo(1, 4);
  });

  it('reconcileHoldingsWithCorporateActionsSync passes after 2:1 split', () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 20,
        avgCost: 50,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const txs: InvestmentTransaction[] = [
      {
        id: 't1',
        portfolioId: 'pf1',
        accountId: 'inv',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'AAPL',
        quantity: 10,
        price: 100,
        total: 1000,
      },
    ];
    const events: CorporateActionEvent[] = [
      {
        id: 'ca1',
        portfolioId: 'pf1',
        actionType: 'stock_split',
        symbol: 'AAPL',
        executionDate: '2026-06-01',
        ratioNumerator: 2,
        ratioDenominator: 1,
        idempotencyKey: 'k1',
        status: 'applied',
      },
    ];
    const rec = reconcileHoldingsWithCorporateActionsSync({
      portfolio,
      symbol: 'AAPL',
      transactions: txs,
      corporateActionEvents: events,
    });
    expect(rec.ok).toBe(true);
    expect(rec.drift).toBeCloseTo(0, 4);
  });

  it('reconcileHoldingsWithCorporateActionsSync passes for manual-only post-split portfolio', () => {
    const portfolio = basePortfolio([
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 20,
        avgCost: 50,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const events: CorporateActionEvent[] = [
      {
        id: 'ca1',
        portfolioId: 'pf1',
        actionType: 'stock_split',
        symbol: 'AAPL',
        executionDate: '2026-06-01',
        ratioNumerator: 2,
        ratioDenominator: 1,
        idempotencyKey: 'k1',
        status: 'applied',
      },
    ];
    const rec = reconcileHoldingsWithCorporateActionsSync({
      portfolio,
      symbol: 'AAPL',
      transactions: [],
      corporateActionEvents: events,
    });
    expect(rec.ok).toBe(true);
    expect(rec.drift).toBeCloseTo(0, 4);
    expect(rec.storedQuantity).toBeCloseTo(20, 4);
  });

  it('holdings dividend reconciliation report is clean after split', () => {
    const holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 20,
      avgCost: 50,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const data = financialDataWithHolding(holding);
    data.investmentTransactions = [
      {
        id: 't1',
        portfolioId: 'pf1',
        accountId: 'inv',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'AAPL',
        quantity: 10,
        price: 100,
        total: 1000,
      },
    ];
    data.corporateActionEvents = [
      {
        id: 'ca1',
        portfolioId: 'pf1',
        actionType: 'stock_split',
        symbol: 'AAPL',
        executionDate: '2026-06-01',
        ratioNumerator: 2,
        ratioDenominator: 1,
        idempotencyKey: 'k1',
        status: 'applied',
      },
    ];
    const report = buildHoldingsDividendReconciliationReport(data);
    expect(report.holdingsMismatchCount).toBe(0);
  });

  it('wealth summary net worth stable across split-adjusted quotes', () => {
    const holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const preQuotes = { AAPL: { price: 100 } };
    const data = financialDataWithHolding(holding);
    const pre = computeWealthSummaryReportModel(data, fx, getCash, preQuotes);
    const split = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    const postQuotes = { AAPL: { price: 50 } };
    const postData = financialDataWithHolding({
      ...holding,
      quantity: split.quantity,
      avgCost: split.avgCost,
      currentValue: 1000,
    });
    const post = computeWealthSummaryReportModel(postData, fx, getCash, postQuotes);
    expect(post.financialMetricsWithEf.netWorth).toBeCloseTo(pre.financialMetricsWithEf.netWorth, 0);
  });

  it('zakat investment total stable across 2:1 split', () => {
    const preHolding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
      acquisitionDate: '2020-01-01',
    };
    const pre = summarizeZakatableInvestmentsForZakat([basePortfolio([preHolding])], fx);
    const split = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    const postHolding = {
      ...preHolding,
      quantity: split.quantity,
      avgCost: split.avgCost,
      currentValue: 1000,
    };
    const post = summarizeZakatableInvestmentsForZakat([basePortfolio([postHolding])], fx);
    expect(post.totalSar).toBeCloseTo(pre.totalSar, 0);
    expect(post.lines[0]?.grossValueSar).toBeCloseTo(pre.lines[0]?.grossValueSar ?? 0, 0);
  });

  it('AI wealth grounding net worth stable across split-adjusted quotes', () => {
    const holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable' as const,
      realizedPnL: 0,
      assetClass: 'Stock' as const,
    };
    const preData = financialDataWithHolding(holding);
    const pre = buildAiPersonalWealthGrounding({
      data: preData,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      simulatedPrices: { AAPL: { price: 100 } },
    });
    const split = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
      holding: { quantity: 10, avgCost: 100 },
    });
    const postData = financialDataWithHolding({
      ...holding,
      quantity: split.quantity,
      avgCost: split.avgCost,
      currentValue: 1000,
    });
    const post = buildAiPersonalWealthGrounding({
      data: postData,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      simulatedPrices: { AAPL: { price: 50 } },
    });
    expect(post.netWorthSar).toBeCloseTo(pre.netWorthSar, 0);
    expect(post.topHoldingsLines.join(' ')).toMatch(/AAPL/i);
  });

  it('quote inverse round-trip restores price', () => {
    const row = { price: 100, change: 2, changePercent: 2 };
    const halved = scaleQuoteRowForSplit(row, 2);
    const restored = scaleQuoteRowForSplit(halved, 0.5);
    expect(restored.price).toBeCloseTo(100, 4);
  });

  it('splitProducesFraction detects reverse split remainder', () => {
    expect(
      splitProducesFraction(15, { type: 'reverse_stock_split', ratioNumerator: 1, ratioDenominator: 10 }),
    ).toBe(true);
    expect(
      splitProducesFraction(100, { type: 'reverse_stock_split', ratioNumerator: 1, ratioDenominator: 10 }),
    ).toBe(false);
  });

  it('CorporateActionWizard routes reverse_stock_split to SplitWizardSteps', () => {
    const wizard = read('components/investments/corporateActions/CorporateActionWizard.tsx');
    expect(wizard).toContain("state.actionType === 'stock_split' || state.actionType === 'reverse_stock_split'");
    expect(wizard).toContain('SplitWizardSteps');
    expect(wizard).toContain('beforeCostBasis');
  });

  it('SystemHealth uses CA-aware holdings reconciliation', () => {
    const page = read('pages/SystemHealth.tsx');
    expect(page).toContain('reconcileHoldingsWithCorporateActionsSync');
    expect(page).toContain('corporateActionEvents');
  });

  it('DataContext apply and undo gate as_stored delta to manual portfolios', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('const manualOnly = replayTxs.length === 0');
    expect(ctx).toContain("holdingsBaselineMode: manualOnly ? 'as_stored' : 'replay_derived'");
  });

  it('DataContext reverses corporate action cash deposits on undo', () => {
    const ctx = read('context/DataContext.tsx');
    const apply = read('services/corporateActionApply.ts');
    expect(ctx).toContain('removeCorporateActionCashDeposits');
    expect(ctx).toContain('dataRef.current');
    expect(ctx).toContain('.in(\'idempotency_key\', keys)');
    expect(apply).toContain('reverse-split-fraction|');
    expect(ctx).toContain('adjustQuotesForCorporateActionNow');
  });

  it('MarketDataContext registers corporate action quote adjust bridge', () => {
    const ctx = read('context/MarketDataContext.tsx');
    expect(ctx).toContain('registerCorporateActionQuoteAdjust');
    expect(ctx).toContain('scaleQuotesForCorporateAction');
    const adjustBlock = ctx.slice(
      ctx.indexOf('const adjustQuotesForCorporateAction'),
      ctx.indexOf('registerCorporateActionQuoteAdjust(adjustQuotesForCorporateAction)'),
    );
    expect(adjustBlock).not.toContain('bumpPriceRefresh');
  });
});
