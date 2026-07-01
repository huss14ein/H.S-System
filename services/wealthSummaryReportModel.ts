/**
 * Single source of truth for wealth summary exports (Settings, Summary) and related KPIs.
 * Pass **CurrencyContext `exchangeRate`** (not a pre-resolved SAR/USD) so FX hydration matches
 * `computePersonalHeadlineNetWorthSar` / Dashboard / Net worth cockpit.
 * Current-month cashflow (income, expenses, P&L) uses `financialMonthNetCashflowSar` from
 * `dashboardKpiSnapshot.ts` — same SAR logic and financial month as `computeDashboardKpiSnapshot`
 * (transaction-dated FX for USD lines).
 */

import type { Account, FinancialData, TradeCurrency, Transaction } from '../types';
import { computeEmergencyFundMetrics, type EmergencyFundMetrics } from '../hooks/useEmergencyFund';
import { toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { getPersonalInvestments, getPersonalSukukPositions, getPersonalWealthData } from '../utils/wealthScope';
import { buildHouseholdBudgetPlan, buildHouseholdEngineInputFromData } from './householdBudgetEngine';
import { deriveCashflowStressSummary } from './householdBudgetStress';
import { computeDisciplineScore, type DisciplineScoreSummary } from './disciplineScoreEngine';
import { computeLiquidityRunwayFromData, type LiquidityRunwaySummary } from './liquidityRunwayEngine';
import {
  computeAllNetWorthChartBucketsSAR,
  computePersonalHeadlineNetWorthSar,
  computePersonalNetWorthBreakdownSAR,
} from './personalNetWorth';
import type { WealthSummaryReportInput } from './reportingEngine';
import { computeRiskLaneFromData, type RiskLaneContext } from './riskLaneEngine';
import { runShockDrill, type ShockDrillResult } from './shockDrillEngine';
import { computeLiquidNetWorth } from './liquidNetWorth';
import { computeHeadlinePersonalInvestmentRoiDecimal } from './investmentKpiCore';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import {
  computeImpliedFinancialMonthNetWorthTrendPct,
  financialMonthNetCashflowSar,
} from './dashboardKpiSnapshot';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { dateInRange, budgetsForFinancialMonthView, resolveMonthStartDayFromData } from '../utils/financialMonth';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import { getSarPerUsdForCalendarDay } from './fxDailySeries';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';

export type GetAvailableCashFn = (accountId: string) => { SAR: number; USD: number };

export interface FinancialMetricsCore {
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  savingsRate: number;
  debtToAssetRatio: number;
  investmentStyle: string;
  netWorthTrend: number;
}

export interface FinancialMetricsWithEf extends FinancialMetricsCore {
  emergencyFundMonths: number;
  efStatus: 'green' | 'yellow' | 'red';
  efTrend: string;
  emergencyShortfall: number;
  emergencyTargetAmount: number;
}

export interface InvestmentTreemapRow {
  avgCost?: number;
  quantity?: number;
  currentValue?: number;
  /** When set, treemap sizes use SAR (consistent with Summary net worth currency). */
  currentValueSar?: number;
  name?: string;
  symbol?: string;
  portfolioCurrency?: string;
  assetClass?: string;
  gainLoss: number;
  gainLossPercent: number;
  [k: string]: unknown;
}

export interface CashflowStressSummary {
  level: string;
  summary: string;
  flags: string[];
  affordabilityPressureMonths?: number;
}

export interface WealthSummaryReportModel {
  financialMetrics: FinancialMetricsCore;
  investmentTreemapData: InvestmentTreemapRow[];
  managedWealthTotal: number;
  emergencyFund: EmergencyFundMetrics;
  financialMetricsWithEf: FinancialMetricsWithEf;
  householdStress: CashflowStressSummary | null;
  riskLane: RiskLaneContext;
  liquidityRunway: LiquidityRunwaySummary | null;
  discipline: DisciplineScoreSummary;
  shockDrill: ShockDrillResult | null;
  liquidNw: ReturnType<typeof computeLiquidNetWorth>;
  wealthSummaryReportPayload: WealthSummaryReportInput;
  /** SAR per USD from `computePersonalHeadlineNetWorthSar` (matches Dashboard headline NW FX path). */
  sarPerUsd: number;
}

function budgetToMonthly(b: { limit: number; period?: string }): number {
  if (b.period === 'yearly') return b.limit / 12;
  if (b.period === 'weekly') return b.limit * (52 / 12);
  if (b.period === 'daily') return b.limit * (365 / 12);
  return b.limit;
}

/**
 * Monthly report extras: budget headroom vs actual spend (Dashboard-aligned SAR cashflow) and portfolio ROI vs net capital.
 * Pass **CurrencyContext `exchangeRate`** (same as `computeWealthSummaryReportModel` / Dashboard KPIs).
 */
export function computeMonthlyReportFinancialKpis(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: GetAvailableCashFn,
  simulatedPrices: SimulatedPriceMap = {},
): { budgetVariance: number; roi: number } {
  const cashflow = financialMonthNetCashflowSar(data, uiExchangeRate);
  const { currentRange } = cashflow;

  const monthlyBudgets = budgetsForFinancialMonthView(
    data.budgets ?? [],
    currentRange.key,
    resolveMonthStartDayFromData(data),
  );

  const transactions = getPersonalTransactions(data);
  const accounts = getPersonalAccounts(data) as Account[];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const headlineForFx = computePersonalHeadlineNetWorthSar(data, uiExchangeRate, {
    getAvailableCashForAccount,
    simulatedPrices,
  });
  const sarPerUsd = headlineForFx.sarPerUsd;

  const txExpenseSar = (t: Transaction) => {
    const acc = accountsById.get(t.accountId ?? '') as Account | undefined;
    const c = acc?.currency === 'USD' ? 'USD' : 'SAR';
    const raw = Math.abs(Number(t.amount) || 0);
    if (c === 'SAR') return raw;
    const day = String(t.date ?? '').slice(0, 10);
    const r = getSarPerUsdForCalendarDay(day, data, uiExchangeRate);
    return toSAR(raw, 'USD', r);
  };

  const actualByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (!dateInRange(t.date, currentRange.start, currentRange.end)) continue;
    if (!countsAsExpenseForCashflowKpi(t)) continue;
    const cat = String(
      (t as Transaction & { budgetCategory?: string }).budgetCategory ?? t.category ?? '',
    ).trim() || 'Uncategorized';
    actualByCategory.set(cat, (actualByCategory.get(cat) ?? 0) + txExpenseSar(t));
  }

  /** Per budget row: positive budget limits vs positive actual spend (expense lines normalised). */
  const monthlyTotals = monthlyBudgets.map((b) => ({
    budgeted: budgetToMonthly(b),
    actual: actualByCategory.get(b.category) ?? 0,
  }));

  const budgetedTotal = monthlyTotals.reduce((sum, { budgeted }) => sum + Math.abs(budgeted), 0);
  /** Include all financial-month spend (budgeted categories + unbudgeted). */
  const actualTotal = Math.abs(cashflow.monthlyExpensesSar);
  const budgetVariance = budgetedTotal - actualTotal;

  const { roi } = computeHeadlinePersonalInvestmentRoiDecimal(
    data,
    sarPerUsd,
    getAvailableCashForAccount,
    simulatedPrices,
  );

  return { budgetVariance, roi };
}

const cur = (c: string | undefined): TradeCurrency => (c === 'SAR' || c === 'USD' ? c : 'USD');

/** Holdings + Sukuk rows for treemap / exports — uses live quotes when provided (Investments hub parity). */
export function buildPersonalInvestmentTreemapRows(
  data: FinancialData,
  sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap = {},
): InvestmentTreemapRow[] {
  const investments = getPersonalInvestments(data);
  const allHoldings = investments.flatMap((p) =>
    (p.holdings || []).map((h) => ({ ...h, portfolioCurrency: p.currency })),
  );
  const holdingRows: InvestmentTreemapRow[] = allHoldings.map((h) => {
    const book = cur(h.portfolioCurrency);
    const valueBook = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
    const currentValueSar = toSAR(valueBook, book, sarPerUsd);
    const totalCost = (h.avgCost ?? 0) * (h.quantity ?? 0);
    const gainLoss = valueBook - totalCost;
    const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
    return {
      ...h,
      currentValue: valueBook,
      gainLoss,
      gainLossPercent,
      currentValueSar,
    };
  });
  const sukukRows: InvestmentTreemapRow[] = getPersonalSukukPositions(data).flatMap((p) => {
    if (p.status === 'completed') return [];
    const v = Math.max(0, Number(p.outstandingPrincipal) || 0);
    if (!(v > 0)) return [];
    const pp = Number(p.purchasePrice);
    const costBasis = Number.isFinite(pp) && pp > 0 ? pp : v;
    const gainLoss = v - costBasis;
    const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
    return [
      {
        symbol: 'SUKUK',
        name: p.name ? `${p.name} (Sukuk)` : 'Sukuk',
        assetClass: 'Sukuk',
        portfolioCurrency: p.currency === 'USD' ? 'USD' : 'SAR',
        quantity: 1,
        avgCost: costBasis,
        currentValue: v,
        currentValueSar: p.currency === 'USD' ? toSAR(v, 'USD', sarPerUsd) : v,
        gainLoss,
        gainLossPercent,
      },
    ];
  });
  return [...holdingRows, ...sukukRows];
}

export function computeWealthSummaryReportModel(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: GetAvailableCashFn,
  simulatedPrices: SimulatedPriceMap = {},
): WealthSummaryReportModel {
  const nwOpts = { getAvailableCashForAccount, simulatedPrices };
  const headlineNw = computePersonalHeadlineNetWorthSar(data, uiExchangeRate, nwOpts);
  const sarPerUsd = headlineNw.sarPerUsd;
  const cf = financialMonthNetCashflowSar(data, uiExchangeRate);
  const monthlyIncome = cf.monthlyIncomeSar;
  const monthlyExpenses = cf.monthlyExpensesSar;
  const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
  const monthlyPnL = cf.monthlyPnLSar;

  const netWorth = headlineNw.netWorth;
  const { totalAssets, totalDebt, totalReceivable } = computePersonalNetWorthBreakdownSAR(data, uiExchangeRate, nwOpts);
  const grossAssets = totalAssets + totalReceivable;
  const debtToAssetRatio = grossAssets > 0 ? totalDebt / grossAssets : 0;

  const netWorthTrend = computeImpliedFinancialMonthNetWorthTrendPct(netWorth, monthlyPnL);

  const headlineInv = computeHeadlinePersonalInvestmentRoiDecimal(
    data,
    sarPerUsd,
    getAvailableCashForAccount,
    simulatedPrices,
  );
  const investmentTreemapData = buildPersonalInvestmentTreemapRows(data, sarPerUsd, simulatedPrices);
  /** Same total as Investments hub headline — not treemap tile sum (excludes idle broker cash). */
  const totalInvestments = headlineInv.totalExposureSar;
  const individualStocksValue = investmentTreemapData
    .filter(
      (h) =>
        String(h.assetClass ?? '') !== 'Sukuk' &&
        !['ETF', 'Index Fund', 'Bond'].some((type) => String(h.name ?? '').includes(type)),
    )
    .reduce((sum, h) => sum + toSAR(h.currentValue ?? 0, cur(h.portfolioCurrency), sarPerUsd), 0);
  const investmentConcentration = totalInvestments > 0 ? individualStocksValue / totalInvestments : 0;
  let investmentStyle = 'Balanced';
  if (investmentConcentration > 0.6) investmentStyle = 'Aggressive (High concentration in individual stocks)';
  else if (investmentConcentration < 0.2) investmentStyle = 'Conservative (High concentration in funds/ETFs)';

  const financialMetrics: FinancialMetricsCore = {
    netWorth,
    monthlyIncome,
    monthlyExpenses,
    savingsRate,
    debtToAssetRatio,
    investmentStyle,
    netWorthTrend,
  };

  const {
    personalAccounts,
    personalAssets,
    personalLiabilities,
    personalInvestments,
    personalCommodityHoldings: _personalCommodities,
  } = getPersonalWealthData(data);

  /** Household vs personal split — use same headline FX + live quotes as personal NW. */
  const personalNW = netWorth;
  const fullNW = computeAllNetWorthChartBucketsSAR(data, uiExchangeRate, nwOpts).netWorth;
  const managedWealthTotal = Math.round(fullNW - personalNW);

  const emergencyFund = computeEmergencyFundMetrics(data, {
    sarPerUsd,
    exchangeRate: uiExchangeRate,
    getAvailableCashForAccount,
  });
  const efStatus: 'green' | 'yellow' | 'red' =
    emergencyFund.status === 'healthy' || emergencyFund.status === 'adequate'
      ? 'green'
      : emergencyFund.status === 'low'
        ? 'yellow'
        : 'red';
  const efTrend =
    emergencyFund.status === 'healthy'
      ? 'Healthy'
      : emergencyFund.status === 'adequate'
        ? 'Adequate'
        : emergencyFund.status === 'low'
          ? 'Low'
          : 'Critical';

  const financialMetricsWithEf: FinancialMetricsWithEf = {
    ...financialMetrics,
    emergencyFundMonths: emergencyFund.monthsCovered,
    efStatus,
    efTrend,
    emergencyShortfall: emergencyFund.shortfall,
    emergencyTargetAmount: emergencyFund.targetAmount,
  };

  const householdInput = buildHouseholdEngineInputFromData(
    getPersonalTransactions(data) as { date: string; type?: string; amount?: number }[],
    getPersonalAccounts(data) as { type?: string; balance?: number }[],
    (data.goals ?? []) as Parameters<typeof buildHouseholdEngineInputFromData>[2],
    {
      year: new Date().getFullYear(),
      expectedMonthlySalary: undefined,
      adults: 2,
      kids: 0,
      profile: (data.settings?.riskProfile as string) || 'Moderate',
      monthlyOverrides: [],
      financialData: data,
      sarPerUsd,
      uiExchangeRate,
    }
  );
  const householdPlan = buildHouseholdBudgetPlan(householdInput);
  const householdStress = deriveCashflowStressSummary(householdPlan) as CashflowStressSummary;

  const riskLane = computeRiskLaneFromData(data, emergencyFund.monthsCovered);
  const liquidityRunway = computeLiquidityRunwayFromData(data, {
    exchangeRate: uiExchangeRate,
    getAvailableCashForAccount,
  });
  const discipline = computeDisciplineScore(data);
  const shockDrill = runShockDrill(data, 'job_loss');
  const liquidNw = computeLiquidNetWorth(data, {
    getAvailableCashForAccount,
    exchangeRate: uiExchangeRate,
    simulatedPrices,
  });

  const wealthSummaryReportPayload: WealthSummaryReportInput = {
    generatedAtIso: new Date().toISOString(),
    currency: 'SAR',
    netWorth: Number(financialMetricsWithEf.netWorth) || 0,
    netWorthTrendPct: Number(financialMetricsWithEf.netWorthTrend) || 0,
    monthlyIncome: Number(financialMetricsWithEf.monthlyIncome) || 0,
    monthlyExpenses: Number(financialMetricsWithEf.monthlyExpenses) || 0,
    monthlyPnL: Number(financialMetricsWithEf.monthlyIncome) - Number(financialMetricsWithEf.monthlyExpenses),
    savingsRatePct: (Number(financialMetricsWithEf.savingsRate) || 0) * 100,
    debtToAssetRatioPct: (Number(financialMetricsWithEf.debtToAssetRatio) || 0) * 100,
    emergencyFundMonths: Number(financialMetricsWithEf.emergencyFundMonths) || 0,
    emergencyFundTargetAmount: Number(financialMetricsWithEf.emergencyTargetAmount) || 0,
    emergencyFundShortfall: Number(financialMetricsWithEf.emergencyShortfall) || 0,
    liquidNetWorth: Number(liquidNw.liquidNetWorth) || 0,
    liquidBreakdown: {
      liquidCash: Number(liquidNw.liquidCash) || 0,
      portfolioHoldingsSar: Number(liquidNw.portfolioHoldingsSar) || 0,
      sukukSar: Number(liquidNw.sukukSar) || 0,
      investmentsSar: Number(liquidNw.investmentsSAR) || 0,
      commodities: Number(liquidNw.commodities) || 0,
      receivables: Number(liquidNw.receivables) || 0,
      creditCardDebtSar: Number(liquidNw.creditCardDebtSar) || 0,
      loanAndMortgageDebtSar: Number(liquidNw.loanAndMortgageDebtSar) || 0,
      shortTermDebt: Number(liquidNw.shortTermDebt) || 0,
      illiquidPhysicalAssetsSar: Number(liquidNw.illiquidPhysicalAssetsSar) || 0,
    },
    managedWealthTotal: Number(managedWealthTotal) || 0,
    riskLane: String(riskLane.lane ?? 'Unknown'),
    liquidityRunwayMonths: Number(liquidityRunway?.monthsOfRunway ?? 0),
    disciplineScore: Number(discipline.score) || 0,
    investmentStyle: String(financialMetricsWithEf.investmentStyle ?? 'Balanced'),
    householdStressLabel: String(householdStress?.level ?? 'Not available'),
    householdStressPressureMonths: Number(householdStress?.affordabilityPressureMonths ?? 0),
    shockDrillSeverity: String(shockDrill?.template?.label ?? 'Not available'),
    shockDrillEstimatedGap: Number(shockDrill?.householdProjectedYearEndDelta ?? 0),
    holdings: investmentTreemapData.map((h) => ({
      symbol: String(h.symbol ?? '').toUpperCase(),
      name: String(h.name ?? h.symbol ?? ''),
      quantity: Number(h.quantity ?? 0),
      avgCost: Number(h.avgCost ?? 0),
      currentValue: Number(h.currentValue ?? 0),
      gainLoss: Number(h.gainLoss ?? 0),
      gainLossPct: Number(h.gainLossPercent ?? 0),
      currency: String(h.portfolioCurrency ?? 'USD'),
      currentValueSar: Number(h.currentValueSar ?? 0),
    })),
    assets: (personalAssets ?? []).map((a: { name?: string; type?: string; value?: number }) => ({
      name: String(a.name ?? ''),
      type: String(a.type ?? ''),
      value: Number(a.value ?? 0),
    })),
    liabilities: (personalLiabilities ?? []).map((l: { name?: string; type?: string; amount?: number; status?: string }) => ({
      name: String(l.name ?? ''),
      type: String(l.type ?? ''),
      amount: Number(l.amount ?? 0),
      status: String(l.status ?? ''),
    })),
    investmentSummary: {
      platformCount: personalAccounts.filter((a: { type?: string }) => a.type === 'Investment').length,
      portfolioCount: personalInvestments.length,
      holdingCount: investmentTreemapData.length,
      platformCashSar: personalAccounts
        .filter((a: { type?: string }) => a.type === 'Investment')
        .reduce((sum: number, a: { id: string }) => sum + tradableCashBucketToSAR(getAvailableCashForAccount(a.id), sarPerUsd), 0),
      holdingsValueSar: investmentTreemapData.reduce((sum, h) => sum + Number(h.currentValueSar ?? 0), 0),
    },
    platforms: personalAccounts
      .filter((a: { type?: string }) => a.type === 'Investment')
      .map((a: { id: string; name?: string; currency?: string }) => {
        const cash = getAvailableCashForAccount(a.id);
        return {
          name: String(a.name ?? ''),
          currency: String(a.currency ?? 'SAR'),
          cashSar: Number(cash.SAR ?? 0),
          cashUsd: Number(cash.USD ?? 0),
          cashTotalSar: tradableCashBucketToSAR(cash, sarPerUsd),
        };
      }),
    portfolios: personalInvestments.map((p: { name?: string; accountId?: string; currency?: string; holdings?: import('../types').Holding[] }) => {
      const holdings = p.holdings ?? [];
      const book = cur(p.currency);
      const valueSar = holdings.reduce(
        (sum: number, h) =>
          sum + toSAR(effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd), book, sarPerUsd),
        0,
      );
      const platform = personalAccounts.find((a: { id: string }) => a.id === p.accountId);
      return {
        name: String(p.name ?? ''),
        platformName: String(platform?.name ?? p.accountId ?? ''),
        currency: String(p.currency ?? 'USD'),
        holdingsCount: holdings.length,
        holdingsValueSar: Number(valueSar || 0),
      };
    }),
  };

  return {
    financialMetrics,
    investmentTreemapData,
    managedWealthTotal,
    emergencyFund,
    financialMetricsWithEf,
    householdStress,
    riskLane,
    liquidityRunway,
    discipline,
    shockDrill,
    liquidNw,
    wealthSummaryReportPayload,
    sarPerUsd,
  };
}
