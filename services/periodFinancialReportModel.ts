/**
 * Canonical Period Financial Report model — soft-fail sections compose existing engines.
 */
import type { Account, FinancialData, Holding, Liability, Transaction } from '../types';
import {
  dateInRange,
  financialMonthIsoKey,
  financialMonthKeyFromTransactionDate,
  financialMonthLookbackRange,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import { toSAR } from '../utils/currencyMath';
import { fxMapForKpiCompute, getSarPerUsdForCalendarDay } from './fxDailySeries';
import {
  countsAsExpenseForCashflowKpi,
  countsAsIncomeForCashflowKpi,
  isInternalTransferTransaction,
} from './transactionFilters';
import { computePersonalHeadlineNetWorthSar } from './personalNetWorth';
import { computeDashboardKpiSnapshot } from './dashboardKpiSnapshot';
import { computeWealthSummaryReportModel } from './wealthSummaryReportModel';
import { computePortfolioPnLForWindow } from './portfolioPeriodPnL';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import {
  resolvePeriodReportTwinWindows,
  type PeriodReportPreset,
  type PeriodReportTwinWindows,
} from './periodReportWindow';
import { detectBudgetDrift } from './budgetDrift';
import { computeExpenseBudgetAnalysisModel } from './expenseBudgetAnalysisModel';
import { subscriptionSpendMonthlySar } from './transactionIntelligence';
import { aggregateCreditCardStatementActivity, resolveCreditCardAmountDue } from './creditCardLedger';
import { projectForecastSeries } from './forecastProjection';
import { computeHeadlinePersonalInvestmentRoiDecimal } from './investmentKpiCore';
import { findCreditCardLiabilityForAccount } from './creditCardLinking';
import { listNetWorthSnapshots } from './netWorthSnapshot';
import { buildHouseholdPlanFromFinancialData } from './householdEngineFromData';
import { debtServiceRatio } from './liabilityMetrics';

export type PeriodReportSectionStatus = 'ok' | 'empty' | 'error';

export type SoftSection<T> = {
  id: string;
  title: string;
  status: PeriodReportSectionStatus;
  error?: string;
  data?: T;
};

export type PeriodCashflowSlice = {
  incomeSar: number;
  expensesSar: number;
  transfersOutSar: number;
  transfersInSar: number;
  netSar: number;
  txCount: number;
};

export type PeriodFinancialReportModel = {
  generatedAtIso: string;
  twin: PeriodReportTwinWindows;
  sections: SoftSection<unknown>[];
  byId: Record<string, SoftSection<unknown>>;
  liveActions: Array<{ id: string; label: string; page: string; action?: string }>;
};

type CashFn = (accountId: string) => { SAR: number; USD: number };

function asCashFn(
  fn: (accountId: string) => { SAR?: number; USD?: number } | null | undefined,
): CashFn {
  return (accountId: string) => {
    const v = fn(accountId);
    return { SAR: Number(v?.SAR) || 0, USD: Number(v?.USD) || 0 };
  };
}

function soft<T>(id: string, title: string, fn: () => T): SoftSection<T> {
  try {
    const data = fn();
    const empty =
      data == null ||
      (Array.isArray(data) && data.length === 0) ||
      (typeof data === 'object' &&
        data !== null &&
        Array.isArray((data as { rows?: unknown[] }).rows) &&
        ((data as { rows?: unknown[] }).rows?.length ?? 0) === 0 &&
        !(data as { note?: unknown }).note &&
        !((data as { insights?: unknown[] }).insights?.length) &&
        !((data as { categories?: unknown[] }).categories?.length));
    return { id, title, status: empty ? 'empty' : 'ok', data };
  } catch (e) {
    return {
      id,
      title,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function txSar(
  t: Transaction,
  accountsById: Map<string, Account>,
  data: FinancialData,
  uiRate: number,
  fxMap: Record<string, number>,
): number {
  const acc = accountsById.get(t.accountId ?? '');
  const c = acc?.currency === 'USD' ? 'USD' : 'SAR';
  const raw = Math.abs(Number(t.amount) || 0);
  if (c === 'SAR') return raw;
  const day = String(t.date || '').slice(0, 10);
  const r = getSarPerUsdForCalendarDay(day, data, uiRate, fxMap);
  return toSAR(raw, 'USD', r);
}

function cashflowInWindow(
  data: FinancialData,
  uiRate: number,
  start: Date,
  end: Date,
): PeriodCashflowSlice {
  const fxMap = fxMapForKpiCompute(data, uiRate);
  const accounts = getPersonalAccounts(data) as Account[];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const txs = getPersonalTransactions(data).filter((t) => dateInRange(t.date, start, end));
  let incomeSar = 0;
  let expensesSar = 0;
  let transfersOutSar = 0;
  let transfersInSar = 0;
  for (const t of txs) {
    const sar = txSar(t, accountsById, data, uiRate, fxMap);
    if (isInternalTransferTransaction(t)) {
      if (Number(t.amount) < 0) transfersOutSar += sar;
      else transfersInSar += sar;
      continue;
    }
    if (countsAsIncomeForCashflowKpi(t)) incomeSar += sar;
    else if (countsAsExpenseForCashflowKpi(t)) expensesSar += sar;
  }
  return {
    incomeSar,
    expensesSar,
    transfersOutSar,
    transfersInSar,
    netSar: incomeSar - expensesSar,
    txCount: txs.length,
  };
}

function topHoldingsGainLoss(
  data: FinancialData,
  sarPerUsd: number,
  limit = 12,
): Array<{ name: string; symbol: string; gainSar: number; valueSar: number }> {
  const rows: Array<{ name: string; symbol: string; gainSar: number; valueSar: number }> = [];
  for (const p of data.investments ?? []) {
    for (const h of (p.holdings ?? []) as Holding[]) {
      const qty = Number(h.quantity) || 0;
      const avg = Number(h.avgCost) || 0;
      const live = Number(h.currentValue) || 0;
      const book = String((p as { currency?: string }).currency || 'SAR').toUpperCase() === 'USD' ? 'USD' : 'SAR';
      const cost = qty * avg;
      const value = live > 0 ? live : cost;
      const gain = value - cost;
      const toSarN = (n: number) => (book === 'USD' ? n * sarPerUsd : n);
      rows.push({
        name: String(h.name || h.symbol || 'Holding'),
        symbol: String(h.symbol || ''),
        gainSar: toSarN(gain),
        valueSar: toSarN(value),
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.gainSar) - Math.abs(a.gainSar)).slice(0, limit);
}

export function buildPeriodFinancialReportModel(args: {
  data: FinancialData;
  uiExchangeRate: number;
  getAvailableCashForAccount: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  simulatedPrices: SimulatedPriceMap;
  preset: PeriodReportPreset;
  customStartIso?: string;
  customEndIso?: string;
  now?: Date;
}): PeriodFinancialReportModel {
  const monthStartDay = resolveMonthStartDayFromData(args.data);
  const twin = resolvePeriodReportTwinWindows({
    preset: args.preset,
    monthStartDay,
    now: args.now,
    customStartIso: args.customStartIso,
    customEndIso: args.customEndIso,
  });
  const { current, prior } = twin;
  const sarPerUsd = args.uiExchangeRate > 0 ? args.uiExchangeRate : 3.75;
  const cash = asCashFn(args.getAvailableCashForAccount);
  const accounts = getPersonalAccounts(args.data) as Account[];

  const sections: SoftSection<unknown>[] = [
    soft('1-executive', '1. Executive snapshot', () => {
      const headline = computePersonalHeadlineNetWorthSar(args.data, args.uiExchangeRate, {
        getAvailableCashForAccount: cash,
        simulatedPrices: args.simulatedPrices,
      });
      const kpi = computeDashboardKpiSnapshot(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const snaps = listNetWorthSnapshots()
        .filter((s) => {
          const t = new Date(s.at).getTime();
          return Number.isFinite(t) && t >= current.start.getTime() && t <= current.end.getTime();
        })
        .sort((a, b) => a.at.localeCompare(b.at));
      const snapshotTrend = snaps.map((s) => ({
        at: s.at.slice(0, 10),
        netWorthSar: Number(s.netWorth) || 0,
      }));
      const firstSnap = snapshotTrend[0]?.netWorthSar;
      const lastSnap = snapshotTrend[snapshotTrend.length - 1]?.netWorthSar;
      return {
        netWorthSar: headline.netWorth,
        liquidCashSar: kpi?.liquidCashSar ?? 0,
        monthlyPnLSar: kpi?.monthlyPnL ?? 0,
        investmentRoi: kpi?.roi ?? 0,
        emergencyFundMonths: wealth.emergencyFund?.monthsCovered ?? null,
        windowLabel: current.label,
        snapshotTrend,
        snapshotDeltaSar:
          firstSnap != null && lastSnap != null ? lastSnap - firstSnap : null,
      };
    }),

    soft('2-cashflow', '2. Period cashflow', () => {
      const cur = cashflowInWindow(args.data, args.uiExchangeRate, current.start, current.end);
      const prev = cashflowInWindow(args.data, args.uiExchangeRate, prior.start, prior.end);
      return {
        current: cur,
        prior: prev,
        deltaNetSar: cur.netSar - prev.netSar,
        waterfall: [
          { label: 'Income', sar: cur.incomeSar },
          { label: 'Expenses', sar: -cur.expensesSar },
          { label: 'Net', sar: cur.netSar },
        ],
      };
    }),

    soft('3-budget', '3. Budget vs actual', () => {
      const analysis = computeExpenseBudgetAnalysisModel(args.data, args.uiExchangeRate, new Date());
      const drift = detectBudgetDrift(args.data, args.uiExchangeRate);
      return {
        categories: (analysis?.categories ?? []).slice(0, 20),
        driftRows: drift.slice(0, 20),
        insights: (analysis?.insights ?? []).slice(0, 8),
        summary: analysis?.summary ?? null,
      };
    }),

    soft('4-portfolio-pnl', '4. Portfolio P/L (window)', () => {
      const personalPortfolios = (args.data.investments ?? []).filter((p) => !p.owner);
      const windowPnL = computePortfolioPnLForWindow({
        data: args.data,
        portfolios: personalPortfolios,
        accounts,
        sarPerUsd,
        simulatedPrices: args.simulatedPrices,
        startMs: current.start.getTime(),
        endMs: current.end.getTime(),
        getAvailableCashForAccount: cash,
      });
      const priorPnL = computePortfolioPnLForWindow({
        data: args.data,
        portfolios: personalPortfolios,
        accounts,
        sarPerUsd,
        simulatedPrices: args.simulatedPrices,
        startMs: prior.start.getTime(),
        endMs: prior.end.getTime(),
        getAvailableCashForAccount: cash,
      });
      return { current: windowPnL, prior: priorPnL };
    }),

    soft('5-holdings-gl', '5. Top holdings gain/loss', () => topHoldingsGainLoss(args.data, sarPerUsd)),

    soft('6-subscriptions', '6. Subscriptions & recurring spend', () => {
      const sub = subscriptionSpendMonthlySar(
        args.data.transactions ?? [],
        accounts,
        sarPerUsd,
        3,
        args.data,
      );
      const windowMonths = Math.max(
        1,
        (current.end.getTime() - current.start.getTime()) / (30.4375 * 86400000),
      );
      return {
        estimatedMonthlySar: sub.monthlyEstimate,
        subscriptionTxCount: sub.count,
        estimatedWindowSar: sub.monthlyEstimate * windowMonths,
        windowMonths,
      };
    }),

    soft('7-credit-cards', '7. Credit card activity', () => {
      const cards = accounts.filter((a) => a.type === 'Credit');
      const startYmd = current.startIso;
      const endYmd = current.endIso;
      return cards.map((card) => {
        const activity = aggregateCreditCardStatementActivity(
          args.data.transactions ?? [],
          card.id,
          startYmd,
          endYmd,
        );
        const liab = findCreditCardLiabilityForAccount(args.data.liabilities ?? [], card.id);
        const due = resolveCreditCardAmountDue(card, liab as Liability | null);
        return {
          accountId: card.id,
          name: card.name,
          balance: card.balance,
          purchaseFlow: activity.purchaseFlow,
          refundFlow: activity.refundFlow,
          payments: activity.paymentPrincipalIn,
          interestAndFees: activity.interestAndFees,
          amountDue: due,
          liabilityName: liab?.name ?? null,
        };
      });
    }),

    soft('8-installments', '8. Installments', () => {
      const notes: Array<{ name: string; note: string }> = [];
      for (const l of (args.data.liabilities ?? []) as Liability[]) {
        const typ = String(l.type || '').toLowerCase();
        if (/install|instal|bnpl|murabaha|loan/.test(typ) || /install|instal|bnpl/i.test(l.name || '')) {
          notes.push({
            name: l.name,
            note: `Outstanding ${Number(l.amount || 0).toFixed(2)} (${l.status ?? 'Active'})`,
          });
        }
      }
      if (!notes.length) {
        return {
          rows: [],
          note: 'No installment-like liabilities tagged. Track BNPL/loans under Liabilities for this section.',
        };
      }
      return { rows: notes, note: null };
    }),

    soft('9-household', '9. Household planned vs actual', () => {
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const plan = buildHouseholdPlanFromFinancialData(args.data, {
        uiExchangeRate: args.uiExchangeRate,
      });
      const pva = plan?.plannedVsActual ?? null;
      return {
        plannedNetSar: pva?.plannedNet ?? null,
        actualNetSar: pva?.actualNet ?? null,
        deltaSar:
          pva != null ? Number(pva.actualNet) - Number(pva.plannedNet) : null,
        householdStress: wealth.householdStress ?? null,
        discipline: wealth.discipline ?? null,
        managedNote: wealth.managedWealthTotal
          ? `Managed wealth excluded from personal NW: ${Number(wealth.managedWealthTotal).toFixed(2)} SAR`
          : 'No managed-wealth carve-out in this period.',
      };
    }),

    soft('10-forecast', '10. Forecast series', () => {
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const headline = computePersonalHeadlineNetWorthSar(args.data, args.uiExchangeRate, {
        getAvailableCashForAccount: cash,
        simulatedPrices: args.simulatedPrices,
      });
      const inv = headline.buckets?.investments ?? 0;
      const series = projectForecastSeries({
        initialNetWorth: headline.netWorth,
        initialInvestmentValue: inv,
        monthlySavings: Math.max(0, Number(wealth.wealthSummaryReportPayload?.monthlyPnL) || 0),
        horizonYears: 1,
        investmentGrowthAnnualPct: 5,
        savingsGrowthAnnualPct: 0,
      });
      return {
        finalNetWorth: series.finalNetWorth,
        finalInvestmentValue: series.finalInvestmentValue,
        rows: series.rows.slice(0, 12),
      };
    }),

    soft('11-transfers-recon', '11. Transfers & Dashboard↔Summary recon', () => {
      const cur = cashflowInWindow(args.data, args.uiExchangeRate, current.start, current.end);
      const kpi = computeDashboardKpiSnapshot(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const summaryMonthly = wealth.wealthSummaryReportPayload?.monthlyPnL ?? null;
      const dash = kpi?.monthlyPnL ?? 0;
      return {
        transferOutSar: cur.transfersOutSar,
        transferInSar: cur.transfersInSar,
        dashboardMonthlyPnL: dash,
        summaryMonthlyPnL: summaryMonthly,
        aligned: summaryMonthly == null || Math.abs(Number(summaryMonthly) - Number(dash)) < 0.05,
      };
    }),

    soft('12-investment-roi', '12. Investment ROI & exposure', () => {
      const roi = computeHeadlinePersonalInvestmentRoiDecimal(
        args.data,
        sarPerUsd,
        cash,
        args.simulatedPrices,
      );
      return {
        roi: roi.roi,
        totalExposureSar: roi.totalExposureSar,
        netCapitalSar: roi.netCapitalSar,
        capitalSource: roi.capitalSource,
      };
    }),

    soft('orphan-budget-insights', 'Budget drift & insights', () => {
      const analysis = computeExpenseBudgetAnalysisModel(args.data, args.uiExchangeRate, new Date());
      return {
        drift: detectBudgetDrift(args.data, args.uiExchangeRate).slice(0, 15),
        insights: analysis?.insights ?? [],
      };
    }),

    soft('orphan-live-nw', 'Live net worth', () =>
      computePersonalHeadlineNetWorthSar(args.data, args.uiExchangeRate, {
        getAvailableCashForAccount: cash,
        simulatedPrices: args.simulatedPrices,
      }),
    ),

    soft('orphan-ef', 'Emergency fund target months', () => {
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      return wealth.emergencyFund;
    }),

    soft('orphan-pti-payoff', 'Payoff order & PTI notes', () => {
      const liabs = ((args.data.liabilities ?? []) as Liability[])
        .filter((l) => (l.status ?? 'Active') === 'Active')
        .map((l) => ({
          name: l.name,
          type: l.type,
          amount: Number(l.amount) || 0,
          interestRate: Number((l as { interestRate?: number }).interestRate) || null,
        }))
        .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0));
      const totalDebt = liabs.reduce((s, l) => s + Math.max(0, l.amount), 0);
      const lookback = financialMonthLookbackRange(args.now ?? new Date(), 6, monthStartDay);
      const incomeByMonth = new Map<string, number>();
      for (const t of getPersonalTransactions(args.data)) {
        if (!countsAsIncomeForCashflowKpi(t)) continue;
        if (!dateInRange(t.date, lookback.start, lookback.end)) continue;
        const k = financialMonthIsoKey(financialMonthKeyFromTransactionDate(t.date, monthStartDay));
        incomeByMonth.set(k, (incomeByMonth.get(k) ?? 0) + Math.abs(Number(t.amount) || 0));
      }
      const avgMonthlyIncome =
        incomeByMonth.size > 0
          ? Array.from(incomeByMonth.values()).reduce((a, b) => a + b, 0) / incomeByMonth.size
          : 0;
      const annualDebtGuess = totalDebt * 0.12;
      const ptiPct =
        avgMonthlyIncome > 0 ? debtServiceRatio(annualDebtGuess, avgMonthlyIncome) * 100 : null;
      return {
        payoffOrder: liabs.slice(0, 12),
        ptiPct,
        avgMonthlyIncomeSar: avgMonthlyIncome,
        note:
          ptiPct == null
            ? 'Ordered by stated interest rate when available (highest first). Add income history for PTI.'
            : `Debt service estimate ~${ptiPct.toFixed(1)}% of income (12% of outstanding / annualized income). Ordered by interest rate.`,
      };
    }),

    soft('orphan-salary', 'Salary detail', () => {
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      return {
        monthlyIncome: wealth.wealthSummaryReportPayload?.monthlyIncome ?? null,
        monthlyPnL: wealth.wealthSummaryReportPayload?.monthlyPnL ?? null,
        savingsRate: wealth.wealthSummaryReportPayload?.savingsRatePct ?? null,
      };
    }),
  ];

  const byId: Record<string, SoftSection<unknown>> = {};
  for (const s of sections) byId[s.id] = s;

  return {
    generatedAtIso: new Date().toISOString(),
    twin,
    sections,
    byId,
    liveActions: [
      { id: 'open-summary', label: 'Open Summary', page: 'Summary' },
      { id: 'open-wealth-analytics', label: 'Open Wealth Analytics', page: 'Wealth Analytics' },
      { id: 'open-budgets', label: 'Review Budgets', page: 'Budgets' },
      { id: 'open-investments', label: 'Investments hub', page: 'Investments' },
      { id: 'open-settings-reports', label: 'Settings → Reports', page: 'Settings', action: 'open-period-financial-report' },
    ],
  };
}

export type { PeriodReportPreset };
