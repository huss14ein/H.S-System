import type { FinancialData } from '../types';
import type { DashboardKpiSnapshot } from './dashboardKpiSnapshot';
import type { PersonalHeadlineNetWorthResult } from './personalNetWorth';
import type { WealthSummaryReportInput } from './reportingEngine';
import { EMERGENCY_FUND_TARGET_MONTHS, type EmergencyFundMetrics } from '../hooks/useEmergencyFund';
import {
  netWorthSparklineFromSnapshots,
  twoPointTrend,
} from './executiveKpiSparklines';
import {
  computePortfolioPeriodPnLSummary,
  computePortfolioPnLDailySeries,
} from './portfolioPeriodPnL';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import { wealthKpiAccent, wealthKpiToneFromStatus, type WealthKpiTone } from './wealthReportPresentation';

export type WealthMetricPassportKey =
  | 'netWorth'
  | 'monthlyPnL'
  | 'investmentRoi'
  | 'budgetVariance'
  | 'emergencyFund';

export type WealthExecutiveKpiRow = {
  key: WealthMetricPassportKey | 'weeklyPnL';
  label: string;
  valueDisplay: string;
  targetDisplay?: string;
  statusLabel: string;
  tone: WealthKpiTone;
  accentColor: string;
  sparkline: number[];
  numericValue: number;
  targetNumeric?: number;
};

export type WealthAnalyticsReportModel = {
  base: WealthSummaryReportInput;
  generatedAtIso: string;
  sarPerUsd: number;
  quotesAsOfIso: string | null;
  quotesLive: boolean;
  executiveKpis: WealthExecutiveKpiRow[];
  weeklyPnLTotalSar: number;
  monthlyPnLTotalSar: number;
  weeklyPnLCumulative: number[];
  monthlyPnLCumulative: number[];
  investmentsTotalSar: number;
  liquidCashSar: number;
  budgetVariance: number;
  investmentRoiPct: number;
  disciplineScore: number;
  liquidityRunwayMonths: number;
};

function fmtSar(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `SAR ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function statusLabelForSigned(value: number, positiveLabel: string, negativeLabel: string): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) return 'Neutral';
  return value >= 0 ? positiveLabel : negativeLabel;
}

/** Extended Wealth Analytics export model — canonical KPIs + P/L series + quote timestamps. */
export function buildWealthAnalyticsReportModel(input: {
  wealthSummaryPayload: WealthSummaryReportInput;
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  emergencyFund: EmergencyFundMetrics;
  data: FinancialData;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  investmentsTotalSar: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  quotesAsOfIso?: string | null;
  quotesLive?: boolean;
}): WealthAnalyticsReportModel {
  const netWorth = input.headline.netWorth ?? input.kpiSnapshot?.netWorth ?? 0;
  const monthlyPnL = input.kpiSnapshot?.monthlyPnL ?? 0;
  const budgetVariance = input.kpiSnapshot?.budgetVariance ?? 0;
  const roi = input.kpiSnapshot?.roi ?? 0;
  const liquidCash = input.kpiSnapshot?.liquidCashSar ?? 0;
  const impliedMonthStart = netWorth - monthlyPnL;

  const portfolios = getPersonalInvestments(input.data);
  const accounts = getPersonalAccounts(input.data);
  const monthStartDay = resolveMonthStartDayFromData(input.data);

  const pnlSummary = computePortfolioPeriodPnLSummary({
    data: input.data,
    portfolios,
    accounts,
    sarPerUsd: input.sarPerUsd,
    simulatedPrices: input.simulatedPrices,
    monthStartDay,
    getAvailableCashForAccount: input.getAvailableCashForAccount,
  });
  const pnlDaily = computePortfolioPnLDailySeries({
    data: input.data,
    portfolios,
    accounts,
    sarPerUsd: input.sarPerUsd,
    simulatedPrices: input.simulatedPrices,
    monthStartDay,
    getAvailableCashForAccount: input.getAvailableCashForAccount,
    summary: pnlSummary,
  });

  const nwSpark = netWorthSparklineFromSnapshots();
  const efMonths = input.emergencyFund.monthsCovered;

  const executiveKpis: WealthExecutiveKpiRow[] = [
    {
      key: 'netWorth',
      label: 'Net worth',
      valueDisplay: fmtSar(netWorth),
      targetDisplay: fmtSar(impliedMonthStart),
      statusLabel: statusLabelForSigned(input.kpiSnapshot?.netWorthTrend ?? monthlyPnL, 'On track', 'Watch'),
      tone: wealthKpiToneFromStatus(statusLabelForSigned(input.kpiSnapshot?.netWorthTrend ?? monthlyPnL, 'On track', 'Watch')),
      accentColor: wealthKpiAccent('netWorth'),
      sparkline: nwSpark.length >= 2 ? nwSpark : twoPointTrend(netWorth, impliedMonthStart),
      numericValue: netWorth,
      targetNumeric: impliedMonthStart,
    },
    {
      key: 'monthlyPnL',
      label: 'Monthly P/L',
      valueDisplay: fmtSar(monthlyPnL),
      targetDisplay: fmtSar(0),
      statusLabel: statusLabelForSigned(monthlyPnL, 'Surplus', 'Deficit'),
      tone: wealthKpiToneFromStatus(statusLabelForSigned(monthlyPnL, 'Surplus', 'Deficit')),
      accentColor: wealthKpiAccent('monthlyPnL'),
      sparkline: twoPointTrend(monthlyPnL, 0),
      numericValue: monthlyPnL,
      targetNumeric: 0,
    },
    {
      key: 'emergencyFund',
      label: 'Emergency fund',
      valueDisplay: `${efMonths.toFixed(1)} mo`,
      targetDisplay: `${EMERGENCY_FUND_TARGET_MONTHS} mo`,
      statusLabel:
        efMonths >= EMERGENCY_FUND_TARGET_MONTHS ? 'Funded' : efMonths >= EMERGENCY_FUND_TARGET_MONTHS / 2 ? 'Building' : 'Gap',
      tone: wealthKpiToneFromStatus(
        efMonths >= EMERGENCY_FUND_TARGET_MONTHS ? 'Funded' : efMonths >= EMERGENCY_FUND_TARGET_MONTHS / 2 ? 'Building' : 'Gap',
      ),
      accentColor: wealthKpiAccent('emergencyFund'),
      sparkline: twoPointTrend(efMonths, EMERGENCY_FUND_TARGET_MONTHS),
      numericValue: efMonths,
      targetNumeric: EMERGENCY_FUND_TARGET_MONTHS,
    },
    {
      key: 'budgetVariance',
      label: 'Budget variance',
      valueDisplay: fmtSar(budgetVariance),
      targetDisplay: fmtSar(0),
      statusLabel: statusLabelForSigned(budgetVariance, 'Under budget', 'Over budget'),
      tone: wealthKpiToneFromStatus(statusLabelForSigned(budgetVariance, 'Under budget', 'Over budget')),
      accentColor: wealthKpiAccent('budgetVariance'),
      sparkline: twoPointTrend(budgetVariance, 0),
      numericValue: budgetVariance,
      targetNumeric: 0,
    },
    {
      key: 'investmentRoi',
      label: 'Investment ROI',
      valueDisplay: `${(roi * 100).toFixed(1)}%`,
      targetDisplay: '0%',
      statusLabel: statusLabelForSigned(roi, 'Gain', 'Loss'),
      tone: wealthKpiToneFromStatus(statusLabelForSigned(roi, 'Gain', 'Loss')),
      accentColor: wealthKpiAccent('investmentRoi'),
      sparkline: twoPointTrend(roi * 100, 0),
      numericValue: roi * 100,
      targetNumeric: 0,
    },
    {
      key: 'weeklyPnL',
      label: 'Weekly P/L',
      valueDisplay: fmtSar(pnlSummary.weeklyTotalSar),
      targetDisplay: fmtSar(0),
      statusLabel: statusLabelForSigned(pnlSummary.weeklyTotalSar, 'Gain', 'Loss'),
      tone: wealthKpiToneFromStatus(statusLabelForSigned(pnlSummary.weeklyTotalSar, 'Gain', 'Loss')),
      accentColor: wealthKpiAccent('weeklyPnL'),
      sparkline:
        pnlDaily.weekly.length >= 2
          ? pnlDaily.weekly.map((p) => p.cumulativeSar)
          : twoPointTrend(pnlSummary.weeklyTotalSar, 0),
      numericValue: pnlSummary.weeklyTotalSar,
      targetNumeric: 0,
    },
  ];

  return {
    base: input.wealthSummaryPayload,
    generatedAtIso: input.wealthSummaryPayload.generatedAtIso,
    sarPerUsd: input.sarPerUsd,
    quotesAsOfIso: input.quotesAsOfIso ?? null,
    quotesLive: input.quotesLive === true,
    executiveKpis,
    weeklyPnLTotalSar: pnlSummary.weeklyTotalSar,
    monthlyPnLTotalSar: pnlSummary.monthlyTotalSar,
    weeklyPnLCumulative: pnlDaily.weekly.map((p) => p.cumulativeSar),
    monthlyPnLCumulative: pnlDaily.monthly.map((p) => p.cumulativeSar),
    investmentsTotalSar: input.investmentsTotalSar,
    liquidCashSar: liquidCash,
    budgetVariance,
    investmentRoiPct: roi * 100,
    disciplineScore: input.wealthSummaryPayload.disciplineScore,
    liquidityRunwayMonths: input.wealthSummaryPayload.liquidityRunwayMonths,
  };
}

export const WEALTH_METRIC_PASSPORT_LABELS: Record<WealthMetricPassportKey, string> = {
  netWorth: 'Net Worth',
  monthlyPnL: 'Monthly P/L',
  investmentRoi: 'Investment ROI',
  budgetVariance: 'Budget Variance',
  emergencyFund: 'Emergency Fund',
};
