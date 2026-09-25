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
import { getPersonalAccounts, getPersonalAssets, getPersonalInvestments, getPersonalLiabilities, getPersonalTransactions, resolveTransactionAccountId } from '../utils/wealthScope';
import { toSAR } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
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
  periodReportToAnalyticsPreset,
  resolvePeriodReportTwinWindows,
  type PeriodReportPreset,
  type PeriodReportTwinWindows,
} from './periodReportWindow';
import { detectBudgetDrift } from './budgetDrift';
import { computeExpenseBudgetAnalysisModel } from './expenseBudgetAnalysisModel';
import {
  detectBnplMentionsSar,
  detectSalaryIncomeSar,
  subscriptionSpendMonthlySar,
} from './transactionIntelligence';
import { aggregateCreditCardStatementActivity, resolveCreditCardAmountDue } from './creditCardLedger';
import { projectForecastSeries } from './forecastProjection';
import { computeHeadlinePersonalInvestmentRoiDecimal } from './investmentKpiCore';
import { findCreditCardLiabilityForAccount } from './creditCardLinking';
import { listNetWorthSnapshots } from './netWorthSnapshot';
import { buildHouseholdPlanFromFinancialData } from './householdEngineFromData';
import { debtPayoffPlan, debtStressScore } from './debtEngines';
import { reconcileDashboardVsSummaryKpis } from './kpiReconciliation';
import { computeSalaryInvestmentKpis } from './salaryInvestmentKpis';
import { decodeInstallmentPaymentNote } from './installments/installmentLinkNote';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import type { PeriodReportInstallmentSnapshot } from './periodReportInstallments';
import { filterInstallmentsInWindow } from './periodReportInstallments';

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
        !((data as { categories?: unknown[] }).categories?.length) &&
        !((data as { plans?: unknown[] }).plans?.length) &&
        !((data as { reconRows?: unknown[] }).reconRows?.length));
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
  const acc = accountsById.get(resolveTransactionAccountId(t));
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

function buildWaterfall(cur: PeriodCashflowSlice): Array<{ label: string; sar: number; cumulative: number }> {
  const transferNet = cur.transfersInSar - cur.transfersOutSar;
  const steps = [
    { label: 'Income', sar: cur.incomeSar },
    { label: 'Expenses', sar: -cur.expensesSar },
    { label: 'Transfers net', sar: transferNet },
    { label: 'Net', sar: cur.netSar },
  ];
  let running = 0;
  return steps.map((s, i) => {
    if (i === steps.length - 1) {
      return { ...s, cumulative: cur.netSar };
    }
    const base = running;
    running += s.sar;
    return { ...s, cumulative: base };
  });
}

function topHoldingsGainLoss(
  data: FinancialData,
  sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
  limit = 12,
): Array<{ name: string; symbol: string; gainSar: number; valueSar: number; costSar: number }> {
  const rows: Array<{ name: string; symbol: string; gainSar: number; valueSar: number; costSar: number }> = [];
  for (const p of getPersonalInvestments(data)) {
    const book = resolveInvestmentPortfolioCurrency(p);
    for (const h of (p.holdings ?? []) as Holding[]) {
      const qty = Number(h.quantity) || 0;
      const avg = Number(h.avgCost) || 0;
      const costBook = qty * avg;
      const valueBook = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
      const value = valueBook > 0 ? valueBook : costBook;
      const gain = value - costBook;
      const toSarN = (n: number) => (book === 'USD' ? n * sarPerUsd : n);
      rows.push({
        name: String(h.name || h.symbol || 'Holding'),
        symbol: String(h.symbol || ''),
        gainSar: toSarN(gain),
        valueSar: toSarN(value),
        costSar: toSarN(costBook),
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.gainSar) - Math.abs(a.gainSar)).slice(0, limit);
}

function monthlyEquivalentSubSar(amount: number, cadence: string, currency: string, sarPerUsd: number): number {
  const book = currency === 'USD' ? 'USD' : 'SAR';
  const sar = book === 'USD' ? amount * sarPerUsd : amount;
  if (cadence === 'yearly') return sar / 12;
  if (cadence === 'weekly') return sar * (52 / 12);
  return sar;
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
  /** Optional Supabase installment plans/rows (Installments page data). */
  installmentSnapshot?: PeriodReportInstallmentSnapshot | null;
  /** When set, only these section ids are kept (plus liveActions always on the model). */
  includeSectionIds?: string[] | null;
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
  const analyticsPreset = periodReportToAnalyticsPreset(args.preset, current);
  const budgetRef = current.end;

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
      const periodCf = cashflowInWindow(args.data, args.uiExchangeRate, current.start, current.end);
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
      // Fallback when device snapshots are sparse: bookend live NW with period cashflow delta.
      const trendForChart =
        snapshotTrend.length >= 2
          ? snapshotTrend
          : [
              { at: current.startIso, netWorthSar: headline.netWorth - periodCf.netSar },
              { at: current.endIso, netWorthSar: headline.netWorth },
            ];
      const firstSnap = trendForChart[0]?.netWorthSar;
      const lastSnap = trendForChart[trendForChart.length - 1]?.netWorthSar;
      return {
        asOfToday: true,
        netWorthSar: headline.netWorth,
        liquidCashSar: kpi?.liquidCashSar ?? 0,
        monthlyPnLSar: kpi?.monthlyPnL ?? 0,
        periodNetCashflowSar: periodCf.netSar,
        periodIncomeSar: periodCf.incomeSar,
        periodExpensesSar: periodCf.expensesSar,
        investmentRoi: kpi?.roi ?? 0,
        emergencyFundMonths: wealth.emergencyFund?.monthsCovered ?? null,
        windowLabel: current.label,
        snapshotTrend: trendForChart,
        snapshotSource: snapshotTrend.length >= 2 ? 'device' : 'synthetic',
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
        waterfall: buildWaterfall(cur),
      };
    }),

    soft('3-budget', '3. Budget vs actual', () => {
      const analysis = computeExpenseBudgetAnalysisModel(
        args.data,
        args.uiExchangeRate,
        budgetRef,
        'personal',
        analyticsPreset,
      );
      const drift = detectBudgetDrift(args.data, args.uiExchangeRate, budgetRef);
      return {
        analyticsPreset,
        periodLabel: analysis?.periodLabel ?? current.label,
        categories: (analysis?.categories ?? []).slice(0, 20),
        driftRows: drift.slice(0, 20),
        insights: (analysis?.insights ?? []).slice(0, 8),
        summary: analysis?.summary ?? null,
      };
    }),

    soft('4-portfolio-pnl', '4. Portfolio P/L (window)', () => {
      const personalPortfolios = getPersonalInvestments(args.data);
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
      return {
        current: windowPnL,
        prior: priorPnL,
        sparkValues: windowPnL.rows.map((r) => r.window.totalSar),
      };
    }),

    soft('5-holdings-gl', '5. Top holdings gain/loss', () =>
      topHoldingsGainLoss(args.data, sarPerUsd, args.simulatedPrices),
    ),

    soft('6-subscriptions', '6. Subscriptions & recurring spend', () => {
      const sub = subscriptionSpendMonthlySar(
        getPersonalTransactions(args.data),
        accounts,
        sarPerUsd,
        3,
        args.data,
      );
      const windowMonths = Math.max(
        1,
        (current.end.getTime() - current.start.getTime()) / (30.4375 * 86400000),
      );
      const plans = (args.data.subscriptions ?? [])
        .filter((s) => s.status === 'active' || s.status === 'paused')
        .map((s) => ({
          name: s.name,
          status: s.status,
          cadence: s.cadence,
          amount: Number(s.amount) || 0,
          currency: s.currency ?? 'SAR',
          monthlySar: monthlyEquivalentSubSar(
            Number(s.amount) || 0,
            s.cadence,
            s.currency ?? 'SAR',
            sarPerUsd,
          ),
          nextRenewalDate: s.nextRenewalDate ?? null,
        }))
        .sort((a, b) => b.monthlySar - a.monthlySar);
      const plannedMonthly = plans
        .filter((p) => p.status === 'active')
        .reduce((s, p) => s + p.monthlySar, 0);
      return {
        estimatedMonthlySar: sub.monthlyEstimate,
        subscriptionTxCount: sub.count,
        estimatedWindowSar: sub.monthlyEstimate * windowMonths,
        windowMonths,
        plannedMonthlySar: plannedMonthly,
        plans: plans.slice(0, 25),
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
      const snap = args.installmentSnapshot;
      const windowRows = snap
        ? filterInstallmentsInWindow(snap.installments, current.startIso, current.endIso)
        : [];
      const scheduleRows = windowRows.slice(0, 40).map((r) => ({
        name: `${r.planName} #${r.sequence}`,
        note: `${r.status}${r.paidAt ? ` · paid ${r.paidAt.slice(0, 10)}` : ` · due ${r.dueDate}`}`,
        amountSar: r.currency === 'USD' ? r.amount * sarPerUsd : r.amount,
        dueDate: r.dueDate,
        status: r.status,
      }));
      const liabilityRows: Array<{ name: string; note: string; amountSar: number }> = [];
      for (const l of (args.data.liabilities ?? []) as Liability[]) {
        const typ = String(l.type || '').toLowerCase();
        if (/install|instal|bnpl|murabaha|loan/.test(typ) || /install|instal|bnpl/i.test(l.name || '')) {
          liabilityRows.push({
            name: l.name,
            note: `Liability outstanding ${Number(l.amount || 0).toFixed(2)} (${l.status ?? 'Active'})`,
            amountSar: Math.abs(Number(l.amount) || 0),
          });
        }
      }
      const bnpl = detectBnplMentionsSar(
        getPersonalTransactions(args.data).filter((t) =>
          dateInRange(t.date, current.start, current.end),
        ),
        accounts,
        sarPerUsd,
      );
      for (const b of bnpl.slice(0, 8)) {
        liabilityRows.push({
          name: b.description.slice(0, 64),
          note: `BNPL mention ${b.date}`,
          amountSar: b.amount,
        });
      }
      let linkedPayments = 0;
      for (const t of getPersonalTransactions(args.data)) {
        if (!dateInRange(t.date, current.start, current.end)) continue;
        if (decodeInstallmentPaymentNote(t.note)) linkedPayments += 1;
      }
      const rows = [...scheduleRows, ...liabilityRows].slice(0, 40);
      const dueSar = scheduleRows
        .filter((r) => String(r.status).toUpperCase() !== 'PAID')
        .reduce((s, r) => s + r.amountSar, 0);
      const paidSar = scheduleRows
        .filter((r) => String(r.status).toUpperCase() === 'PAID')
        .reduce((s, r) => s + r.amountSar, 0);
      return {
        plans: (snap?.plans ?? []).slice(0, 20).map((p) => ({
          name: p.description,
          status: p.status,
          count: p.installmentCount,
          totalSar: p.currency === 'USD' ? p.totalAmount * sarPerUsd : p.totalAmount,
          category: p.budgetCategory,
        })),
        rows,
        dueInWindowSar: dueSar,
        paidInWindowSar: paidSar,
        linkedPaymentsInWindow: linkedPayments,
        fetchError: snap?.error ?? null,
        note:
          rows.length === 0
            ? snap?.error
              ? `Installment fetch: ${snap.error}`
              : 'No installment schedule rows or BNPL/liability matches in this window.'
            : null,
      };
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
        ref: budgetRef,
      });
      const pva = plan?.plannedVsActual ?? null;
      const monthRows = (plan?.months ?? [])
        .slice(0, 12)
        .map((m, i) => ({
          monthIndex: i + 1,
          plannedNet: Number((m as { plannedNet?: number }).plannedNet) || 0,
          incomeActual: Number((m as { incomeActual?: number }).incomeActual) || 0,
          expenseActual: Number((m as { expenseActual?: number }).expenseActual) || 0,
        }));
      return {
        plannedNetSar: pva?.plannedNet ?? null,
        actualNetSar: pva?.actualNet ?? null,
        deltaSar: pva != null ? Number(pva.actualNet) - Number(pva.plannedNet) : null,
        monthRows,
        householdStress: wealth.householdStress
          ? {
              level: (wealth.householdStress as { level?: string }).level ?? null,
              affordabilityPressureMonths:
                (wealth.householdStress as { affordabilityPressureMonths?: number })
                  .affordabilityPressureMonths ?? null,
            }
          : null,
        discipline: wealth.discipline
          ? {
              score: (wealth.discipline as { score?: number }).score ?? null,
              label: (wealth.discipline as { label?: string }).label ?? null,
            }
          : null,
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
      const salary = computeSalaryInvestmentKpis(args.data, args.uiExchangeRate);
      const inv = headline.buckets?.investments ?? 0;
      const monthlySavings = Math.max(
        0,
        Number(wealth.wealthSummaryReportPayload?.monthlyPnL) ||
          Number(salary?.investedFromSalarySarMonth) ||
          0,
      );
      const growthPct = 5;
      const series = projectForecastSeries({
        initialNetWorth: headline.netWorth,
        initialInvestmentValue: inv,
        monthlySavings,
        horizonYears: 1,
        investmentGrowthAnnualPct: growthPct,
        savingsGrowthAnnualPct: 0,
      });
      return {
        assumptions: {
          monthlySavingsSar: monthlySavings,
          investmentGrowthAnnualPct: growthPct,
          horizonYears: 1,
          source: salary?.investedFromSalarySarMonth
            ? 'salary-invest / wealth monthly P&L'
            : 'wealth monthly P&L (floored at 0)',
        },
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
      const recon = reconcileDashboardVsSummaryKpis({
        dashboard: {
          netWorth: Number(kpi?.netWorth ?? 0),
          monthlyPnL: Number(kpi?.monthlyPnL ?? 0),
          budgetVariance: Number(kpi?.budgetVariance ?? 0),
          roi: Number(kpi?.roi ?? 0),
          emergencyFundMonths: Number(wealth.emergencyFund?.monthsCovered ?? 0),
        },
        summaryMetrics: wealth.financialMetricsWithEf,
        summaryMonthlyExtras: wealth.monthlyReportFinancialKpis,
      });
      return {
        asOfToday: true,
        transferOutSar: cur.transfersOutSar,
        transferInSar: cur.transfersInSar,
        transferNetSar: cur.transfersInSar - cur.transfersOutSar,
        reconOk: recon.ok,
        mismatchCount: recon.mismatchCount,
        reconRows: recon.rows,
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
        asOfToday: true,
        roi: roi.roi,
        totalExposureSar: roi.totalExposureSar,
        netCapitalSar: roi.netCapitalSar,
        capitalSource: roi.capitalSource,
      };
    }),

    soft('orphan-budget-insights', 'Budget drift & insights', () => {
      const analysis = computeExpenseBudgetAnalysisModel(
        args.data,
        args.uiExchangeRate,
        budgetRef,
        'personal',
        analyticsPreset,
      );
      return {
        analyticsPreset,
        drift: detectBudgetDrift(args.data, args.uiExchangeRate, budgetRef).slice(0, 15),
        insights: analysis?.insights ?? [],
      };
    }),

    soft('orphan-live-nw', 'Live net worth (as of today)', () => {
      const headline = computePersonalHeadlineNetWorthSar(args.data, args.uiExchangeRate, {
        getAvailableCashForAccount: cash,
        simulatedPrices: args.simulatedPrices,
      });
      return { asOfToday: true, ...headline };
    }),

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
      const active = ((args.data.liabilities ?? []) as Liability[]).filter(
        (l) => (l.status ?? 'Active') === 'Active',
      );
      const debtItems = active.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        balance: Math.abs(Number(l.amount) || 0),
        annualRatePct: Number((l as { interestRate?: number }).interestRate) || 12,
        monthlyPayment: Math.abs(Number(l.amount) || 0) * 0.02,
      }));
      const orderIds = debtPayoffPlan(
        debtItems.map((d) => ({
          id: d.id,
          balance: d.balance,
          annualRatePct: d.annualRatePct,
          monthlyPayment: d.monthlyPayment,
        })),
        'avalanche',
      );
      const byId = new Map(debtItems.map((d) => [d.id, d]));
      const payoffOrder = orderIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .slice(0, 12)
        .map((d) => ({
          name: d!.name,
          type: d!.type,
          amount: d!.balance,
          interestRate: d!.annualRatePct,
          monthlyPaymentEst: d!.monthlyPayment,
        }));
      const totalDebt = debtItems.reduce((s, d) => s + d.balance, 0);
      const monthlyPaymentsEst = totalDebt * 0.02;
      const salary = detectSalaryIncomeSar(
        getPersonalTransactions(args.data),
        accounts,
        sarPerUsd,
        6,
        args.data,
      );
      const lookback = financialMonthLookbackRange(args.now ?? new Date(), 6, monthStartDay);
      const fxMap = fxMapForKpiCompute(args.data, args.uiExchangeRate);
      const accountsById = new Map(accounts.map((a) => [a.id, a]));
      const incomeByMonth = new Map<string, number>();
      for (const t of getPersonalTransactions(args.data)) {
        if (!countsAsIncomeForCashflowKpi(t)) continue;
        if (!dateInRange(t.date, lookback.start, lookback.end)) continue;
        const k = financialMonthIsoKey(financialMonthKeyFromTransactionDate(t.date, monthStartDay));
        incomeByMonth.set(
          k,
          (incomeByMonth.get(k) ?? 0) + txSar(t, accountsById, args.data, args.uiExchangeRate, fxMap),
        );
      }
      const avgMonthlyIncome =
        incomeByMonth.size > 0
          ? Array.from(incomeByMonth.values()).reduce((a, b) => a + b, 0) / incomeByMonth.size
          : salary.estimatedMonthly;
      const liquid = accounts
        .filter((a) => a.type === 'Checking' || a.type === 'Savings')
        .reduce((s, a) => s + toSAR(Math.max(0, Number(a.balance) || 0), a.currency === 'USD' ? 'USD' : 'SAR', sarPerUsd), 0);
      const stress = debtStressScore(monthlyPaymentsEst, Math.max(1, avgMonthlyIncome), liquid);
      return {
        payoffOrder,
        ptiPct: stress.paymentToIncomeRatio * 100,
        stressLabel: stress.label,
        stressScore: stress.score,
        avgMonthlyIncomeSar: avgMonthlyIncome,
        salaryDetected: salary.detected,
        salaryEstimateSar: salary.estimatedMonthly,
        note: `Avalanche payoff order (Liabilities engine). PTI from estimated monthly payments (2% of outstanding) ÷ income. ${salary.label}`,
      };
    }),

    soft('orphan-salary', 'Salary detail', () => {
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const salary = detectSalaryIncomeSar(
        getPersonalTransactions(args.data),
        accounts,
        sarPerUsd,
        6,
        args.data,
      );
      const kpis = computeSalaryInvestmentKpis(args.data, args.uiExchangeRate);
      return {
        monthlyIncome: wealth.wealthSummaryReportPayload?.monthlyIncome ?? null,
        monthlyPnL: wealth.wealthSummaryReportPayload?.monthlyPnL ?? null,
        savingsRate: wealth.wealthSummaryReportPayload?.savingsRatePct ?? null,
        salaryDetected: salary.detected,
        salaryEstimateSar: salary.estimatedMonthly,
        salaryLabel: salary.label,
        salaryInvestRatePct: kpis?.salaryInvestRatePct ?? null,
        investedFromSalarySarMonth: kpis?.investedFromSalarySarMonth ?? null,
        fundedNotDeployedSar: kpis?.fundedNotDeployedSar ?? null,
      };
    }),

    soft('appendix-inventory', 'Appendix — balance sheet inventory', () => {
      const wealth = computeWealthSummaryReportModel(
        args.data,
        args.uiExchangeRate,
        cash,
        args.simulatedPrices,
      );
      const payload = wealth.wealthSummaryReportPayload;
      const platforms = (payload?.platforms ?? []).slice(0, 20);
      const holdings = (payload?.holdings ?? []).slice(0, 40);
      const assets = getPersonalAssets(args.data)
        .slice(0, 25)
        .map((a) => ({ name: a.name, type: a.type, value: Number(a.value) || 0 }));
      const liabilities = getPersonalLiabilities(args.data)
        .slice(0, 25)
        .map((l) => ({
          name: l.name,
          type: l.type,
          amount: Number(l.amount) || 0,
          status: l.status ?? 'Active',
        }));
      return {
        asOfToday: true,
        investmentSummary: payload?.investmentSummary ?? null,
        platforms,
        holdings,
        assets,
        liabilities,
      };
    }),
  ];

  const include = args.includeSectionIds?.length
    ? new Set(args.includeSectionIds)
    : null;
  const filtered = include ? sections.filter((s) => include.has(s.id)) : sections;

  const byId: Record<string, SoftSection<unknown>> = {};
  for (const s of filtered) byId[s.id] = s;

  return {
    generatedAtIso: new Date().toISOString(),
    twin,
    sections: filtered,
    byId,
    liveActions: [
      { id: 'open-summary', label: 'Open Summary', page: 'Summary' },
      { id: 'open-wealth-analytics', label: 'Open Wealth Analytics', page: 'Wealth Analytics' },
      { id: 'open-budgets', label: 'Review Budgets', page: 'Budgets' },
      { id: 'open-investments', label: 'Investments hub', page: 'Investments' },
      { id: 'open-subscriptions', label: 'Subscriptions', page: 'Subscriptions' },
      { id: 'open-installments', label: 'Installments', page: 'Installments' },
      { id: 'open-liabilities', label: 'Liabilities / payoff', page: 'Liabilities' },
      {
        id: 'open-settings-reports',
        label: 'Settings → Reports',
        page: 'Settings',
        action: 'open-period-financial-report',
      },
    ],
  };
}

export const PERIOD_REPORT_SECTION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: '1-executive', label: '1. Executive snapshot' },
  { id: '2-cashflow', label: '2. Period cashflow' },
  { id: '3-budget', label: '3. Budget vs actual' },
  { id: '4-portfolio-pnl', label: '4. Portfolio P/L' },
  { id: '5-holdings-gl', label: '5. Top holdings G/L' },
  { id: '6-subscriptions', label: '6. Subscriptions' },
  { id: '7-credit-cards', label: '7. Credit cards' },
  { id: '8-installments', label: '8. Installments' },
  { id: '9-household', label: '9. Household' },
  { id: '10-forecast', label: '10. Forecast' },
  { id: '11-transfers-recon', label: '11. Transfers & recon' },
  { id: '12-investment-roi', label: '12. Investment ROI' },
  { id: 'orphan-budget-insights', label: 'Budget drift & insights' },
  { id: 'orphan-live-nw', label: 'Live net worth' },
  { id: 'orphan-ef', label: 'Emergency fund' },
  { id: 'orphan-pti-payoff', label: 'Payoff & PTI' },
  { id: 'orphan-salary', label: 'Salary detail' },
  { id: 'appendix-inventory', label: 'Appendix inventory' },
];

export type { PeriodReportPreset };
