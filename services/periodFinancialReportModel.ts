/**
 * Period Financial Report model — composes only canonical engines for a selected window.
 * Soft-fails individual sections so print never crashes on missing optional data.
 */
import type { Account, FinancialData, Liability, Transaction } from '../types';
import {
  financialMonthIsoKey,
  financialMonthLabel,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import {
  getPersonalAccounts,
  getPersonalInvestments,
  getPersonalLiabilities,
  getPersonalTransactions,
  getScopedCashTransactions,
} from '../utils/wealthScope';
import { filterTransactionsForLedgerView } from '../utils/transactionLedgerFilters';
import { computeCanonicalFinancialMetrics } from './canonicalFinancialMetrics';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import {
  compareSnapshots,
  getSnapshotForDayOrLastBefore,
  listNetWorthSnapshots,
  type NetWorthSnapshot,
} from './netWorthSnapshot';
import { computeLiquidNetWorth } from './liquidNetWorth';
import { sumTradableCashSarFromInvestmentAccounts } from './investmentCashLedger';
import {
  personalMonthlyInflowOutflowByFinancialMonthSar,
  savingsRateSarFinancialMonth,
} from './financeMetrics';
import { computeExpenseBudgetAnalysisModel, type AnalyticsPeriodPreset } from './expenseBudgetAnalysisModel';
import { detectBudgetDrift } from './budgetDrift';
import { computePortfolioPnLForWindow } from './portfolioPeriodPnL';
import { presentHeadlineInvestmentGrowth } from './extendedMetricsPresentation';
import { sumPersonalSukukPositionsSar } from './sukuk/sukukExposure';
import { computePersonalCommoditiesContributionSAR } from './investmentPlatformCardMetrics';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { getPersonalInvestmentTransactionsForKpis } from './investmentKpiCore';
import { debtPayoffPlan, debtStressScore } from './debtEngines';
import { computeEmergencyFundMetrics } from '../hooks/useEmergencyFund';
import { computeLiquidityRunwayFromData } from './liquidityRunwayEngine';
import { computeRiskLaneFromData } from './riskLaneEngine';
import { computeDisciplineScore } from './disciplineScoreEngine';
import { computeHouseholdStressFromData } from './householdBudgetStress';
import { runShockDrill, SHOCK_TEMPLATES } from './shockDrillEngine';
import { evaluateLifestyleGuardrailsFromData } from './lifestyleGuardrails';
import { computeCapitalDeployment } from './capitalDeploymentOrchestrator';
import { computeGoalResolvedAmountsSar } from './goalResolvedTotals';
import { goalProgressPercent, computeGoalTimelineStatus } from './goalMetrics';
import { detectGoalConflictsFromData } from './goalConflictDetection';
import { computeCanonicalPlanningSnapshot } from './canonicalPlanningEngine';
import { computeSalaryInvestmentKpis } from './salaryInvestmentKpis';
import { summarizeZakatableCashForZakat } from './zakatCashValuation';
import {
  summarizeZakatableCommoditiesForZakat,
  summarizeZakatableInvestmentsForZakat,
  summarizeZakatableSukukPositionsForZakat,
} from './zakatInvestmentValuation';
import { computeDeductibleLiabilities } from './zakatLiabilityMath';
import { buildFinancialIntegrityReport } from './dataQuality/financialIntegrity';
import { detectStaleMarketData } from './dataQuality/marketDataStale';
import { buildEnhancementSignals } from './financialEnhancementSignals';
import { buildWealthChangeWaterfallSteps } from './wealthChangeWaterfallModel';
import { buildPersonalInvestmentTreemapRows, computeWealthSummaryReportModel } from './wealthSummaryReportModel';
import { subscriptionSpendMonthlySar } from './transactionIntelligence';
import { aggregateCreditCardStatementActivity } from './creditCardLedger';
import { buildHouseholdPlanFromFinancialData } from './householdEngineFromData';
import { projectForecastSeries } from './forecastProjection';
import { buildTransferClearanceReport } from './transferClearance';
import { reconcileDashboardVsSummaryKpis } from './kpiReconciliation';
import { computeFinancialEnginesIntegration } from './financialEnginesIntegrationCompute';
import {
  periodReportWindowMs,
  resolvePeriodReportWindow,
  type PeriodReportPreset,
  type PeriodReportWindow,
} from './periodReportWindow';
import { toSAR } from '../utils/currencyMath';
import { resolveSarPerUsd } from '../utils/currencyMath';

export type PeriodFinancialReportRecommendation = {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  metricRef?: string;
};

export type PeriodFinancialReportModel = {
  generatedAtIso: string;
  window: PeriodReportWindow;
  cover: {
    periodLabel: string;
    sarPerUsd: number;
    quotesAsOf: string | null;
    integritySeverity: string | null;
    staleQuotes: boolean;
    personalNetWorthSar: number;
    managedNote: string | null;
    taxDisclaimer: string;
  };
  wealth: {
    startNwSar: number | null;
    endNwSar: number;
    deltaSar: number | null;
    deltaPct: number | null;
    startSnapshotFallback: boolean;
    buckets: {
      cash: number;
      investments: number;
      physical: number;
      liabilities: number;
    };
    liquidNetWorthSar: number;
    liquidCashSar: number;
    tradableBrokerCashSar: number;
    availableLiquiditySar: number;
    emergencyFundFloorSar: number;
    reservedLiquiditySar: number;
    priorDeltaSar: number | null;
    snapshotTrend: { at: string; netWorth: number }[];
    waterfall: { name: string; deltaSar: number }[];
  };
  cashflow: {
    months: {
      key: string;
      label: string;
      inflow: number;
      outflow: number;
      net: number;
      savingsRatePct: number;
    }[];
    totals: { inflow: number; outflow: number; net: number; avgSavingsRatePct: number };
    priorTotals: { inflow: number; outflow: number; net: number } | null;
    salaryInvest: {
      ratePct: number | null;
      attributedSar: number | null;
      detail: string | null;
    };
    subscriptionsMonthlySar: number | null;
    subscriptionsCount: number;
  };
  budgets: {
    periodPresetUsed: AnalyticsPeriodPreset;
    categories: {
      category: string;
      spentSar: number;
      limitSar: number;
      utilizationPct: number;
      status: string;
    }[];
    insights: { priority: string; title: string; detail: string }[];
    drift: { category: string; driftPct: number }[];
  };
  transactions: {
    count: number;
    byCategory: { category: string; amountSar: number; count: number }[];
    rows: {
      id: string;
      date: string;
      description: string;
      amount: number;
      category: string;
      accountId: string;
      accountName: string;
      type: string;
      budgetCategory?: string;
      subcategory?: string;
      transactionNature?: string;
      expenseType?: string;
      status?: string;
    }[];
  };
  investments: {
    totalExposureSar: number;
    roiAsOfLabel: string;
    roiPctDisplay: string;
    netInvestedSar: number | null;
    growthSar: number | null;
    allocation: { label: string; valueSar: number; sharePct: number }[];
    portfolioPeriodPnL: {
      portfolioName: string;
      totalSar: number;
      ledgerSar: number;
      marketSar: number;
      valueSar: number;
    }[];
    periodPnLTotalSar: number;
    priorPeriodPnLTotalSar: number | null;
    feesSar: number;
    vatSar: number;
    dividendsSar: number;
    topHoldings: {
      symbol: string;
      name: string;
      valueSar: number;
      gainLossSar: number;
      gainLossPct: number;
    }[];
  };
  sukukCommodities: {
    sukukExposureSar: number;
    commodityContributionSar: number;
    payoutEventsInPeriod: {
      date: string;
      kind: string;
      amount: number;
      currency: string;
      name: string;
    }[];
  };
  debt: {
    totalLiabilitiesSar: number;
    stress: { score: number; label: string; paymentToIncomeRatio: number } | null;
    payoffOrderIds: string[];
    liabilities: { id: string; name: string; balanceSar: number; type: string }[];
    creditCards: {
      accountId: string;
      name: string;
      purchaseFlow: number;
      refundFlow: number;
      paymentPrincipalIn: number;
      interestAndFees: number;
    }[];
    installmentNotes: string[];
  };
  safety: {
    emergencyFund: {
      monthsCovered: number;
      status: string;
      shortfall: number;
      targetMonths: number;
    };
    runwayMonths: number | null;
    riskLane: string | null;
    suggestedProfile: string | null;
    disciplineScore: number | null;
    householdStress: string | null;
    shockDrills: { id: string; label: string; yearEndDelta: number | null }[];
    lifestyleHits: string[];
    capitalDeployableSar: number | null;
  };
  goalsPlan: {
    goals: {
      id: string;
      name: string;
      progressPct: number;
      fundedSar: number;
      targetSar: number;
      gapSar: number;
      timeline: string;
    }[];
    conflicts: string[];
    planRowCount: number;
    crossEngineActions: string[];
    householdPlannedNet: number | null;
    householdActualNet: number | null;
    forecastFinalNw: number | null;
    forecastHorizonYears: number | null;
    forecastSeries: { label: string; netWorth: number }[];
  };
  zakatInsurance: {
    zakatableCashSar: number;
    zakatableInvestmentsSar: number;
    zakatableSukukSar: number;
    zakatableCommoditiesSar: number;
    deductibleLiabilitiesSar: number;
    insuranceNotes: string[];
    rewardsSar: number;
  };
  dataQuality: {
    integrityIssues: string[];
    staleQuotes: boolean;
    snapshotWarning: string | null;
    reconNotes: string[];
  };
  recommendations: PeriodFinancialReportRecommendation[];
};

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapBudgetPreset(preset: PeriodReportPreset, finKeyCount: number): AnalyticsPeriodPreset {
  if (preset === 'ytd' || preset === 'financial_year') return 'YTD';
  if (preset === 'last_12m' || preset === 'calendar_year') return '12M';
  if (finKeyCount <= 1) return 'MTD';
  if (finKeyCount <= 3) return '3M';
  if (finKeyCount <= 6) return '6M';
  return '12M';
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export type BuildPeriodFinancialReportModelArgs = {
  data: FinancialData;
  exchangeRate: number;
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  simulatedPrices?: SimulatedPriceMap;
  preset: PeriodReportPreset;
  customStart?: string;
  customEnd?: string;
  ref?: Date;
  quotesAsOf?: string | null;
  snapshots?: NetWorthSnapshot[];
};

export function buildPeriodFinancialReportModel(
  args: BuildPeriodFinancialReportModelArgs,
): PeriodFinancialReportModel {
  const {
    data,
    exchangeRate,
    getAvailableCashForAccount,
    simulatedPrices = {},
    preset,
    customStart,
    customEnd,
    ref = new Date(),
    quotesAsOf = null,
  } = args;

  const monthStartDay = resolveMonthStartDayFromData(data);
  const window = resolvePeriodReportWindow({
    ref,
    monthStartDay,
    preset,
    customStart,
    customEnd,
  });
  const { startMs, endMs } = periodReportWindowMs(window);
  const priorMs = periodReportWindowMs(window.priorWindow);

  const metrics = computeCanonicalFinancialMetrics({
    data,
    exchangeRate,
    getAvailableCashForAccount,
    simulatedPrices,
  });
  const sarPerUsd = metrics.sarPerUsd;
  const snapshots = args.snapshots ?? safe(() => listNetWorthSnapshots(), []);
  const endDay = isoDay(window.end);
  const startDay = isoDay(window.start);
  const periodIncludesToday = ref.getTime() >= window.start.getTime() && ref.getTime() <= window.end.getTime() + 86400000;

  const startSnap = getSnapshotForDayOrLastBefore(startDay, snapshots);
  const endSnap = periodIncludesToday
    ? null
    : getSnapshotForDayOrLastBefore(endDay, snapshots);
  const endNw = periodIncludesToday || !endSnap ? metrics.netWorth : endSnap.netWorth;
  const startNw = startSnap?.netWorth ?? null;
  const startSnapshotFallback = !startSnap;
  const deltaSar = startNw != null ? endNw - startNw : null;
  const deltaPct = startNw != null && Math.abs(startNw) > 1e-6 ? (deltaSar! / Math.abs(startNw)) * 100 : null;

  const priorCmp = safe(
    () =>
      compareSnapshots(
        snapshots,
        isoDay(window.priorWindow.start),
        isoDay(window.priorWindow.end),
      ),
    null,
  );

  const liquid = safe(
    () =>
      computeLiquidNetWorth(data, {
        exchangeRate,
        getAvailableCashForAccount,
        simulatedPrices,
      }),
    {
      liquidCash: metrics.liquidCashSar,
      liquidNetWorth: metrics.liquidCashSar,
      illiquidPhysicalAssetsSar: 0,
      shortTermDebt: 0,
      investmentsSAR: metrics.investmentsTotalSar,
      portfolioHoldingsSar: 0,
      sukukSar: 0,
      commodities: 0,
      receivables: 0,
      creditCardDebtSar: 0,
      loanAndMortgageDebtSar: 0,
      contributionEstimate30d: 0,
      marketMoveEstimate30d: 0,
    },
  );

  const tradable = safe(
    () =>
      sumTradableCashSarFromInvestmentAccounts(
        getPersonalAccounts(data),
        data.accounts ?? getPersonalAccounts(data),
        sarPerUsd,
      ),
    metrics.investableCashTotalSar,
  );

  const snapshotTrend = safe(() => {
    return snapshots
      .map((s) => ({ at: String(s.at ?? '').slice(0, 10), netWorth: Number(s.netWorth) || 0 }))
      .filter((p) => p.at && p.at >= startDay && p.at <= endDay)
      .sort((a, b) => a.at.localeCompare(b.at));
  }, [] as { at: string; netWorth: number }[]);

  // Cashflow months in window
  const monthsBack = Math.max(12, window.finKeys.length + window.priorWindow.finKeys.length + 2);
  const monthly = safe(
    () => personalMonthlyInflowOutflowByFinancialMonthSar(data, exchangeRate, monthsBack),
    { monthKeys: [], inflow: [], outflow: [], net: [], byKey: new Map() },
  );
  const personalTx = getPersonalTransactions(data) as Transaction[];
  const personalAccts = getPersonalAccounts(data) as Account[];

  const cashflowMonths = window.finKeys.map((fk: FinancialMonthKey) => {
    const key = financialMonthIsoKey(fk);
    const row = monthly.byKey.get(key) ?? { inflow: 0, outflow: 0, net: 0 };
    const mid = financialMonthRangeFromKey(fk, monthStartDay).start;
    const savingsRatePct = safe(
      () => savingsRateSarFinancialMonth(personalTx, personalAccts, mid, data, exchangeRate),
      0,
    );
    return {
      key,
      label: financialMonthLabel(fk, monthStartDay),
      inflow: row.inflow,
      outflow: row.outflow,
      net: row.net,
      savingsRatePct,
    };
  });
  const cfTotals = cashflowMonths.reduce(
    (a, m) => ({
      inflow: a.inflow + m.inflow,
      outflow: a.outflow + m.outflow,
      net: a.net + m.net,
      avgSavingsRatePct: 0,
    }),
    { inflow: 0, outflow: 0, net: 0, avgSavingsRatePct: 0 },
  );
  cfTotals.avgSavingsRatePct =
    cashflowMonths.length > 0
      ? cashflowMonths.reduce((s, m) => s + m.savingsRatePct, 0) / cashflowMonths.length
      : 0;

  const priorMonths = window.priorWindow.finKeys.map((fk) => {
    const key = financialMonthIsoKey(fk);
    return monthly.byKey.get(key) ?? { inflow: 0, outflow: 0, net: 0 };
  });
  const priorTotals = priorMonths.length
    ? priorMonths.reduce(
        (a, m) => ({ inflow: a.inflow + m.inflow, outflow: a.outflow + m.outflow, net: a.net + m.net }),
        { inflow: 0, outflow: 0, net: 0 },
      )
    : null;

  const salary = safe(() => computeSalaryInvestmentKpis(data, exchangeRate), null);

  const budgetPreset = mapBudgetPreset(preset, window.finKeys.length);
  const budgetModel = safe(
    () => computeExpenseBudgetAnalysisModel(data, exchangeRate, ref, 'personal', budgetPreset),
    null,
  );
  const drift = safe(() => detectBudgetDrift(data, exchangeRate), []);

  const ledgerRows = safe(() => {
    const scoped = getScopedCashTransactions(
      data,
      personalAccts.map((a) => a.id),
    ) as Transaction[];
    return filterTransactionsForLedgerView(
      scoped,
      {
        accountId: 'all',
        month: '',
        allMonths: false,
        dateRangeOverride: { start: window.start, end: window.end },
        nature: 'all',
        expenseType: 'all',
        budgetCategory: 'all',
      },
      monthStartDay,
    );
  }, [] as Transaction[]);

  const acctName = new Map(personalAccts.map((a) => [a.id, a.name || a.id]));
  const byCategoryMap = new Map<string, { amountSar: number; count: number }>();
  const spot = resolveSarPerUsd(data, exchangeRate);
  for (const t of ledgerRows) {
    const cat = String(t.budgetCategory || t.category || 'Uncategorized');
    const cur = (personalAccts.find((a) => a.id === t.accountId)?.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD';
    const amt = toSAR(Math.abs(Number(t.amount) || 0), cur, spot);
    const row = byCategoryMap.get(cat) ?? { amountSar: 0, count: 0 };
    row.amountSar += amt;
    row.count += 1;
    byCategoryMap.set(cat, row);
  }

  const portfolios = getPersonalInvestments(data);
  const accounts = (data.accounts ?? personalAccts) as Account[];
  const periodPnL = safe(
    () =>
      computePortfolioPnLForWindow({
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        startMs,
        endMs,
        getAvailableCashForAccount,
      }),
    { rows: [], totalSar: 0, ledgerTotalSar: 0, marketTotalSar: 0, startMs, endMs },
  );
  const priorPnL = safe(
    () =>
      computePortfolioPnLForWindow({
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        startMs: priorMs.startMs,
        endMs: priorMs.endMs,
        getAvailableCashForAccount,
      }),
    null,
  );

  const growthPresent = metrics.investmentExposure
    ? presentHeadlineInvestmentGrowth(metrics.investmentExposure)
    : null;

  let feesSar = 0;
  let vatSar = 0;
  let dividendsSar = 0;
  safe(() => {
    const invTx = getPersonalInvestmentTransactionsForKpis(data);
    for (const t of invTx) {
      const day = String(t.date ?? '').slice(0, 10);
      if (!day) continue;
      const ms = new Date(
        Number(day.slice(0, 4)),
        Number(day.slice(5, 7)) - 1,
        Number(day.slice(8, 10)),
      ).getTime();
      if (ms < startMs || ms > endMs) continue;
      const cash = Math.abs(
        investmentTransactionCashAmountSarDated({
          tx: t,
          accounts,
          portfolios,
          data,
          uiExchangeRate: exchangeRate,
        }) || 0,
      );
      if (isInvestmentTransactionType(t.type, 'fee')) feesSar += cash;
      else if (isInvestmentTransactionType(t.type, 'vat')) vatSar += cash;
      else if (isInvestmentTransactionType(t.type, 'dividend')) dividendsSar += cash;
    }
  }, undefined);

  const sukukSar = safe(() => sumPersonalSukukPositionsSar(data, sarPerUsd), 0);
  const commoditySar = safe(
    () => computePersonalCommoditiesContributionSAR(data, sarPerUsd, simulatedPrices).valueSAR,
    metrics.headlineExposureParts?.commoditiesValueSar ?? 0,
  );
  const sukukEvents = safe(() => {
    const positions = data.sukukPositions ?? [];
    const nameById = new Map(positions.map((p) => [p.id, p.name]));
    return (data.sukukPayoutEvents ?? [])
      .filter((e) => {
        const d = String(e.payoutDate ?? '').slice(0, 10);
        if (!d) return false;
        const ms = new Date(
          Number(d.slice(0, 4)),
          Number(d.slice(5, 7)) - 1,
          Number(d.slice(8, 10)),
        ).getTime();
        return ms >= startMs && ms <= endMs;
      })
      .map((e) => ({
        date: String(e.payoutDate).slice(0, 10),
        kind: String(e.kind ?? 'payout'),
        amount: Number(e.amount) || 0,
        currency: String(e.currency ?? 'SAR'),
        name: nameById.get(e.sukukPositionId) ?? 'Sukuk',
      }));
  }, [] as PeriodFinancialReportModel['sukukCommodities']['payoutEventsInPeriod']);

  const liabilities = getPersonalLiabilities(data) as Liability[];
  const liabilityRows = liabilities.map((l) => ({
    id: l.id,
    name: l.name || l.id,
    balanceSar: Math.max(0, Number(l.amount) || 0),
    type: String(l.type ?? 'Debt'),
  }));
  const totalLiabilitiesSar = liabilityRows.reduce((s, r) => s + r.balanceSar, 0);
  const monthlyDebtPay =
    liabilities.reduce((s, l) => s + (Number(l.minPayment) || 0), 0) ||
    totalLiabilitiesSar * 0.02;
  const grossIncome = cfTotals.inflow / Math.max(1, cashflowMonths.length);
  const stress = safe(
    () => debtStressScore(monthlyDebtPay, Math.max(grossIncome, 1), liquid.liquidCash),
    null,
  );
  const payoffOrderIds = safe(
    () =>
      debtPayoffPlan(
        liabilities.map((l) => ({
          id: l.id,
          balance: Math.max(0, Number(l.amount) || 0),
          annualRatePct: Number(l.apr) || 0,
          monthlyPayment: Number(l.minPayment) || 0,
        })),
        'avalanche',
      ),
    [],
  );

  const ef = computeEmergencyFundMetrics(data, {
    exchangeRate,
    sarPerUsd,
    getAvailableCashForAccount,
  });
  const runway = safe(
    () => computeLiquidityRunwayFromData(data, { exchangeRate, getAvailableCashForAccount }),
    null,
  );
  const risk = safe(() => computeRiskLaneFromData(data, ef.monthsCovered), null);
  const discipline = safe(() => computeDisciplineScore(data), null);
  const hhStress = safe(() => computeHouseholdStressFromData(data), null);
  const shocks = SHOCK_TEMPLATES.map((t) => {
    const r = safe(() => runShockDrill(data, t.id), null);
    return {
      id: t.id,
      label: t.label,
      yearEndDelta: r?.householdProjectedYearEndDelta ?? null,
    };
  });
  const lifestyle = safe(
    () =>
      evaluateLifestyleGuardrailsFromData(
        data,
        ef.monthsCovered,
        ef.targetMonths,
        cfTotals.avgSavingsRatePct / 100,
      ),
    [] as { code: string; message: string; severity: string }[],
  );
  const capital = safe(
    () =>
      computeCapitalDeployment(
        data,
        exchangeRate,
        getAvailableCashForAccount,
        ef.monthsCovered,
        ef.targetMonths,
      ),
    null,
  );

  const goalAmounts = safe(() => computeGoalResolvedAmountsSar(data, sarPerUsd), new Map());
  const goals = (data.goals ?? []).map((g) => {
    const funded = Number(goalAmounts.get(g.id) ?? g.currentAmount ?? 0);
    const target = Number(g.targetAmount) || 0;
    const progressPct = goalProgressPercent({ ...g, currentAmount: funded });
    const timeline = safe(
      () =>
        computeGoalTimelineStatus({
          goal: g,
          resolvedCurrentAmountSar: funded,
          projectedMonthlyContribution: 0,
          fromDate: ref,
        }),
      null,
    );
    return {
      id: g.id,
      name: g.name,
      progressPct,
      fundedSar: funded,
      targetSar: target,
      gapSar: Math.max(0, target - funded),
      timeline: timeline?.status ?? '—',
    };
  });
  const conflicts = safe(() => {
    const c = detectGoalConflictsFromData(data, sarPerUsd);
    if (Array.isArray(c)) {
      return c.map((x: { message?: string; severity?: string }) => String(x.message ?? x));
    }
    return [] as string[];
  }, [] as string[]);

  const planSnap = safe(
    () =>
      computeCanonicalPlanningSnapshot({
        data: data as never,
        exchangeRate,
        sarPerUsd,
        simulatedPrices,
        getAvailableCashForAccount,
      }),
    null,
  );

  const zakCash = safe(
    () => summarizeZakatableCashForZakat(personalAccts, personalTx, sarPerUsd),
    { totalSar: 0, grossTotalSar: 0, lines: [] },
  );
  const zakInv = safe(
    () =>
      summarizeZakatableInvestmentsForZakat(
        portfolios,
        sarPerUsd,
        getPersonalInvestmentTransactionsForKpis(data),
      ),
    { totalSar: 0, lines: [] },
  );
  const zakSuk = safe(() => summarizeZakatableSukukPositionsForZakat(data, sarPerUsd), {
    totalSar: 0,
    lines: [],
  });
  const zakCom = safe(
    () => summarizeZakatableCommoditiesForZakat(data.commodityHoldings ?? []),
    { totalSar: 0, lines: [] },
  );
  const deductible = safe(
    () =>
      computeDeductibleLiabilities({
        accounts: personalAccts,
        liabilities,
        otherDebts: 0,
        sarPerUsd,
      }),
    { total: 0, shortTermDebts: 0, trackedLiabilities: 0, otherDebts: 0 },
  );

  const integrity = safe(
    () => buildFinancialIntegrityReport(personalAccts as never, personalTx as never),
    null,
  );
  const stale = safe(
    () => detectStaleMarketData(quotesAsOf ? new Date(quotesAsOf) : null, true).isStale,
    false,
  );

  const enhancement = safe(() => buildEnhancementSignals(data, sarPerUsd), null);

  const waterfall = safe(
    () =>
      buildWealthChangeWaterfallSteps({
        netWorthSar: endNw,
        monthlyPnLSar: metrics.kpiSnapshot?.monthlyPnL ?? cfTotals.net / Math.max(1, cashflowMonths.length),
        buckets: {
          cash: Number(metrics.headline?.buckets?.cash ?? metrics.liquidCashSar),
          investments: Number(metrics.headline?.buckets?.investments ?? metrics.investmentsTotalSar),
          liabilities: Number(metrics.headline?.buckets?.liabilities ?? totalLiabilitiesSar),
        },
      }).map((s) => ({ name: s.name, deltaSar: s.deltaSar })),
    [] as { name: string; deltaSar: number }[],
  );

  const topHoldings = safe(() => {
    const rows = buildPersonalInvestmentTreemapRows(data, sarPerUsd, simulatedPrices);
    return [...rows]
      .sort((a, b) => Math.abs(Number(b.gainLoss) || 0) - Math.abs(Number(a.gainLoss) || 0))
      .slice(0, 15)
      .map((h) => ({
        symbol: String(h.symbol ?? ''),
        name: String(h.name ?? h.symbol ?? ''),
        valueSar: Number(h.currentValueSar ?? h.currentValue ?? 0),
        gainLossSar: Number(h.gainLoss ?? 0),
        gainLossPct: Number(h.gainLossPercent ?? 0),
      }));
  }, [] as PeriodFinancialReportModel['investments']['topHoldings']);

  const subs = safe(
    () => subscriptionSpendMonthlySar(personalTx, personalAccts, sarPerUsd, 3, data),
    { monthlyEstimate: 0, count: 0 },
  );

  const creditCards = safe(() => {
    const startYmd = isoDay(window.start);
    const endYmd = isoDay(window.end);
    const creditAccts = personalAccts.filter((a) => String(a.type).toLowerCase() === 'credit');
    return creditAccts.map((a) => {
      const act = aggregateCreditCardStatementActivity(personalTx, a.id, startYmd, endYmd);
      return {
        accountId: a.id,
        name: a.name || a.id,
        purchaseFlow: Number(act.purchaseFlow) || 0,
        refundFlow: Number(act.refundFlow) || 0,
        paymentPrincipalIn: Number(act.paymentPrincipalIn) || 0,
        interestAndFees: Number(act.interestAndFees) || 0,
      };
    });
  }, [] as PeriodFinancialReportModel['debt']['creditCards']);

  const installmentNotes = safe(() => {
    const notes: string[] = [];
    const subsLedger = (data as { subscriptions?: { name?: string; amount?: number; status?: string; cadence?: string }[] })
      .subscriptions;
    if (Array.isArray(subsLedger) && subsLedger.length) {
      const active = subsLedger.filter((s) => String(s.status ?? 'active').toLowerCase() !== 'cancelled');
      notes.push(`${active.length} subscription ledger record(s) on file.`);
    }
    const inst = (data as { installments?: unknown[] }).installments;
    if (Array.isArray(inst) && inst.length) {
      notes.push(`${inst.length} installment plan(s) tracked in workspace.`);
    }
    if (!notes.length && (subs.count ?? 0) > 0) {
      notes.push(
        `Heuristic subscription spend ~${Math.round(subs.monthlyEstimate).toLocaleString()} SAR/mo (${subs.count} keyword matches).`,
      );
    }
    return notes;
  }, [] as string[]);

  const householdPlan = safe(
    () => buildHouseholdPlanFromFinancialData(data, { uiExchangeRate: exchangeRate, year: ref.getFullYear() }),
    null,
  );
  const householdPlannedNet =
    householdPlan && Number.isFinite(householdPlan.plannedVsActual?.plannedNet)
      ? Number(householdPlan.plannedVsActual.plannedNet)
      : null;
  const householdActualNet =
    householdPlan && Number.isFinite(householdPlan.plannedVsActual?.actualNet)
      ? Number(householdPlan.plannedVsActual.actualNet)
      : null;

  const forecast = safe(() => {
    const monthlySavings = cfTotals.net / Math.max(1, cashflowMonths.length);
    return projectForecastSeries({
      initialNetWorth: endNw,
      initialInvestmentValue: metrics.investmentsTotalSar,
      monthlySavings,
      horizonYears: 5,
      investmentGrowthAnnualPct: 7,
      savingsGrowthAnnualPct: 0,
    });
  }, null);
  const forecastSeries = safe(() => {
    if (!forecast?.rows?.length) return [] as { label: string; netWorth: number }[];
    // Sample yearly points for the print chart (months 12, 24, … + final).
    const rows = forecast.rows;
    const picks: { label: string; netWorth: number }[] = [];
    for (let i = 11; i < rows.length; i += 12) {
      const r = rows[i]!;
      picks.push({ label: r.name, netWorth: r['Net Worth'] });
    }
    const last = rows[rows.length - 1]!;
    if (!picks.length || picks[picks.length - 1]!.label !== last.name) {
      picks.push({ label: last.name, netWorth: last['Net Worth'] });
    }
    return picks;
  }, [] as { label: string; netWorth: number }[]);

  const transferClearance = safe(() => buildTransferClearanceReport(personalTx), null);
  const wealthSummaryFull = safe(
    () => computeWealthSummaryReportModel(data, exchangeRate, getAvailableCashForAccount, simulatedPrices),
    null,
  );
  const kpiRecon = safe(() => {
    if (!metrics.kpiSnapshot || !wealthSummaryFull) return null;
    return reconcileDashboardVsSummaryKpis({
      dashboard: {
        netWorth: metrics.netWorth,
        monthlyPnL: metrics.kpiSnapshot.monthlyPnL,
        budgetVariance: metrics.kpiSnapshot.budgetVariance,
        roi: metrics.kpiSnapshot.roi,
        emergencyFundMonths: ef.monthsCovered,
      },
      summaryMetrics: wealthSummaryFull.financialMetricsWithEf,
      summaryMonthlyExtras: wealthSummaryFull.monthlyReportFinancialKpis,
    });
  }, null);

  const engines = safe(() => computeFinancialEnginesIntegration(data, false), null);
  const crossActions = safe(() => {
    const queue = engines?.actionQueue;
    if (Array.isArray(queue) && queue.length) {
      return queue.map((a) => `${a.action}${a.details ? ` — ${a.details}` : ''}`).filter(Boolean);
    }
    const alerts = engines?.analysis?.alerts;
    if (Array.isArray(alerts)) {
      return alerts.map((a) => String(a.suggestedAction ?? a.message ?? a)).filter(Boolean);
    }
    return [] as string[];
  }, [] as string[]);

  const reconNotes: string[] = [];
  if (kpiRecon) {
    reconNotes.push(
      kpiRecon.ok
        ? 'Dashboard ↔ Summary KPI reconcile: OK'
        : `Dashboard ↔ Summary KPI mismatches: ${kpiRecon.mismatchCount}`,
    );
    for (const row of kpiRecon.rows.filter((r) => !r.withinThreshold).slice(0, 8)) {
      reconNotes.push(
        `${row.label}: dashboard ${row.dashboardValue.toFixed(2)} vs summary ${row.summaryValue.toFixed(2)}`,
      );
    }
  }
  if (transferClearance) {
    const unpaired = (transferClearance as { unpaired?: unknown[] }).unpaired?.length ?? 0;
    const imbalanced = (transferClearance as { imbalanced?: unknown[] }).imbalanced?.length ?? 0;
    reconNotes.push(`Transfer clearance: ${unpaired} unpaired, ${imbalanced} imbalanced group(s).`);
  }

  const recommendations: PeriodFinancialReportRecommendation[] = [];
  if (enhancement) {
    const conflictsList = (enhancement as { goalConflicts?: { severity?: string; message?: string }[] })
      .goalConflicts;
    for (const c of conflictsList ?? []) {
      recommendations.push({
        severity: (c.severity as 'high' | 'medium' | 'low') || 'medium',
        title: 'Goal conflict',
        detail: String(c.message ?? ''),
        metricRef: 'goals',
      });
    }
    const driftList = (enhancement as { budgetDrift?: { category?: string; driftPct?: number }[] })
      .budgetDrift;
    for (const d of driftList ?? []) {
      recommendations.push({
        severity: Math.abs(Number(d.driftPct) || 0) > 20 ? 'high' : 'medium',
        title: `Budget drift · ${d.category ?? 'category'}`,
        detail: `Drift ${Number(d.driftPct || 0).toFixed(1)}% vs envelope.`,
        metricRef: 'budgets',
      });
    }
  }
  for (const insight of budgetModel?.insights ?? []) {
    recommendations.push({
      severity: insight.priority === 'high' ? 'high' : insight.priority === 'medium' ? 'medium' : 'low',
      title: insight.title,
      detail: insight.detail,
      metricRef: 'budgets',
    });
  }
  for (const a of crossActions.slice(0, 8)) {
    recommendations.push({ severity: 'info', title: 'Cross-engine action', detail: a, metricRef: 'plan' });
  }
  if (ef.status === 'critical' || ef.status === 'low') {
    recommendations.push({
      severity: 'high',
      title: 'Strengthen emergency fund',
      detail: `Coverage ${ef.monthsCovered.toFixed(1)} months (target ${ef.targetMonths}). Shortfall SAR ${Math.round(ef.shortfall).toLocaleString()}.`,
      metricRef: 'emergencyFund',
    });
  }

  const lifestyleHits: string[] = Array.isArray(lifestyle)
    ? lifestyle.map((h) => String(h.message ?? h))
    : [];

  const integrityIssues: string[] = [];
  if (integrity) {
    const issues =
      (integrity as { issues?: { message?: string }[]; findings?: { message?: string }[]; summary?: string })
        .issues ??
      (integrity as { findings?: { message?: string }[] }).findings ??
      [];
    if (Array.isArray(issues)) integrityIssues.push(...issues.map((i) => String(i.message ?? i)));
    if ((integrity as { summary?: string }).summary) {
      integrityIssues.push(String((integrity as { summary?: string }).summary));
    }
  }

  const buckets = metrics.headline?.buckets ?? {
    cash: metrics.liquidCashSar,
    investments: metrics.investmentsTotalSar,
    physicalAndCommodities: liquid.illiquidPhysicalAssetsSar,
    liabilities: totalLiabilitiesSar,
  };

  return {
    generatedAtIso: new Date().toISOString(),
    window,
    cover: {
      periodLabel: window.periodLabel,
      sarPerUsd,
      quotesAsOf,
      integritySeverity: integrityIssues.length ? 'attention' : 'ok',
      staleQuotes: Boolean(stale),
      personalNetWorthSar: metrics.netWorth,
      managedNote: null,
      taxDisclaimer:
        'Tax reporting is out of product scope (KSA). Fees/VAT/dividends below are informational ledger totals only.',
    },
    wealth: {
      startNwSar: startNw,
      endNwSar: endNw,
      deltaSar,
      deltaPct,
      startSnapshotFallback,
      buckets: {
        cash: Number(buckets.cash ?? metrics.liquidCashSar),
        investments: Number(buckets.investments ?? metrics.investmentsTotalSar),
        physical: Number(
          (buckets as { physicalAndCommodities?: number }).physicalAndCommodities ??
            liquid.illiquidPhysicalAssetsSar,
        ),
        liabilities: Number(buckets.liabilities ?? totalLiabilitiesSar),
      },
      liquidNetWorthSar: liquid.liquidNetWorth,
      liquidCashSar: liquid.liquidCash,
      tradableBrokerCashSar: tradable,
      availableLiquiditySar: metrics.availableLiquiditySar,
      emergencyFundFloorSar: metrics.emergencyFundFloorSar,
      reservedLiquiditySar: metrics.reservedLiquiditySar,
      priorDeltaSar: priorCmp?.change ?? null,
      snapshotTrend,
      waterfall,
    },
    cashflow: {
      months: cashflowMonths,
      totals: cfTotals,
      priorTotals,
      salaryInvest: {
        ratePct: salary?.salaryInvestRatePct ?? null,
        attributedSar: salary?.investedFromSalarySarMonth ?? null,
        detail: salary ? 'Salary → invest KPIs (canonical monthly attribution).' : null,
      },
      subscriptionsMonthlySar: subs.monthlyEstimate ?? null,
      subscriptionsCount: subs.count ?? 0,
    },
    budgets: {
      periodPresetUsed: budgetPreset,
      categories: (budgetModel?.categories ?? []).slice(0, 40).map((c) => ({
        category: c.category,
        spentSar: c.spentSar,
        limitSar: c.limitSar,
        utilizationPct: c.utilizationPct,
        status: c.status,
      })),
      insights: (budgetModel?.insights ?? []).map((i) => ({
        priority: i.priority,
        title: i.title,
        detail: i.detail,
      })),
      drift: (Array.isArray(drift) ? drift : [])
        .slice(0, 20)
        .map((d: { category?: string; driftPct?: number }) => ({
          category: String(d.category ?? ''),
          driftPct: Number(d.driftPct) || 0,
        })),
    },
    transactions: {
      count: ledgerRows.length,
      byCategory: [...byCategoryMap.entries()]
        .map(([category, v]) => ({ category, amountSar: v.amountSar, count: v.count }))
        .sort((a, b) => b.amountSar - a.amountSar),
      rows: ledgerRows.map((t) => ({
        id: String(t.id ?? ''),
        date: String(t.date ?? '').slice(0, 10),
        description: String(t.description ?? ''),
        amount: Number(t.amount) || 0,
        category: String(t.category ?? ''),
        accountId: String(t.accountId ?? ''),
        accountName: acctName.get(t.accountId) ?? '',
        type: String(t.type ?? ''),
        budgetCategory: t.budgetCategory,
        subcategory: t.subcategory,
        transactionNature: t.transactionNature,
        expenseType: t.expenseType,
        status: t.status,
      })),
    },
    investments: {
      totalExposureSar: metrics.investmentsTotalSar,
      roiAsOfLabel: 'As-of report date (not period TWR)',
      roiPctDisplay: growthPresent?.valueDisplay ?? '—',
      netInvestedSar: growthPresent?.netInvestedSar ?? metrics.investmentExposure?.netCapitalSar ?? null,
      growthSar: growthPresent?.growthSar ?? metrics.investmentExposure?.totalGainLossSar ?? null,
      allocation: (() => {
        const rows = metrics.investmentAllocation?.assetClassAllocation ?? [];
        const total = Math.max(1, metrics.investmentAllocation?.totalSar ?? metrics.investmentsTotalSar ?? 1);
        return rows.map((s) => ({
          label: String(s.name ?? 'Other'),
          valueSar: Number(s.value) || 0,
          sharePct: ((Number(s.value) || 0) / total) * 100,
        }));
      })(),
      portfolioPeriodPnL: periodPnL.rows.map((r) => ({
        portfolioName: r.portfolioName,
        totalSar: r.period.totalSar,
        ledgerSar: r.period.ledgerSar,
        marketSar: r.period.marketEstimateSar,
        valueSar: r.valueSar,
      })),
      periodPnLTotalSar: periodPnL.totalSar,
      priorPeriodPnLTotalSar: priorPnL?.totalSar ?? null,
      feesSar,
      vatSar,
      dividendsSar,
      topHoldings,
    },
    sukukCommodities: {
      sukukExposureSar: sukukSar,
      commodityContributionSar: commoditySar,
      payoutEventsInPeriod: sukukEvents,
    },
    debt: {
      totalLiabilitiesSar,
      stress,
      payoffOrderIds,
      liabilities: liabilityRows,
      creditCards,
      installmentNotes,
    },
    safety: {
      emergencyFund: {
        monthsCovered: ef.monthsCovered,
        status: String(ef.status),
        shortfall: ef.shortfall,
        targetMonths: ef.targetMonths,
      },
      runwayMonths: runway?.monthsOfRunway ?? null,
      riskLane: risk?.lane ?? null,
      suggestedProfile: risk?.suggestedProfile ?? null,
      disciplineScore: discipline?.score ?? null,
      householdStress: hhStress?.level ?? null,
      shockDrills: shocks,
      lifestyleHits,
      capitalDeployableSar: capital?.investableSurplusSar ?? null,
    },
    goalsPlan: {
      goals,
      conflicts,
      planRowCount: (() => {
        if (!planSnap) return 0;
        const anyPlan = planSnap as unknown as { rows?: unknown[]; investmentRows?: unknown[] };
        if (Array.isArray(anyPlan.rows)) return anyPlan.rows.length;
        if (Array.isArray(anyPlan.investmentRows)) return anyPlan.investmentRows.length;
        return 0;
      })(),
      crossEngineActions: crossActions,
      householdPlannedNet,
      householdActualNet,
      forecastFinalNw: forecast?.finalNetWorth ?? null,
      forecastHorizonYears: forecast ? 5 : null,
      forecastSeries,
    },
    zakatInsurance: {
      zakatableCashSar: Number((zakCash as { totalSar?: number }).totalSar) || 0,
      zakatableInvestmentsSar: Number((zakInv as { totalSar?: number }).totalSar) || 0,
      zakatableSukukSar: Number((zakSuk as { totalSar?: number }).totalSar) || 0,
      zakatableCommoditiesSar: Number((zakCom as { totalSar?: number }).totalSar) || 0,
      deductibleLiabilitiesSar: Number(deductible.total) || 0,
      insuranceNotes: [
        'No structured insurance policies on FinancialData — configure coverage in Engines & Tools for gap/renewal checks.',
        ...((engines as { analysis?: { alerts?: { message?: string }[] } } | null)?.analysis?.alerts ?? [])
          .filter((a) => /insur/i.test(String(a.message ?? '')))
          .map((a) => String(a.message)),
      ],
      rewardsSar: metrics.rewardsSar,
    },
    dataQuality: {
      integrityIssues: integrityIssues.slice(0, 30),
      staleQuotes: Boolean(stale),
      snapshotWarning: startSnapshotFallback
        ? 'No net-worth snapshot on/near period start — start NW may be unavailable or approximate.'
        : null,
      reconNotes,
    },
    recommendations: recommendations.slice(0, 40),
  };
}
