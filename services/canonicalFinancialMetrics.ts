/**
 * **Single entry point** for headline personal financial metrics (browser, exports, command palette, hooks).
 * React surfaces should prefer `useCanonicalFinancialMetrics()` which calls this with live context inputs.
 */
import type { FinancialData } from '../types';
import {
  computePersonalHeadlineNetWorthSar,
  computePersonalNetWorthBreakdownSAR,
  computeTodayBalanceSheetSnapshotSar,
  sumPersonalSukukAssetsSar,
  type PersonalHeadlineNetWorthResult,
  type PersonalNetWorthBreakdownSAR,
  type PersonalNetWorthOptions,
  type TodayBalanceSheetSnapshotSAR,
} from './personalNetWorth';
import { computeDashboardKpiSnapshot, type DashboardKpiSnapshot } from './dashboardKpiSnapshot';
import { computeWealthSummaryReportModel, type WealthSummaryReportModel } from './wealthSummaryReportModel';
import {
  buildInvestableCashBarsFromInvestmentAccounts,
  sumTradableCashSarFromInvestmentAccounts,
  type InvestableCashBarRow,
} from './investmentCashLedger';
import { getPersonalAccounts } from '../utils/wealthScope';
import {
  computePersonalCommoditiesContributionSAR,
  type SimulatedPriceMap,
} from './investmentPlatformCardMetrics';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
  type HeadlinePersonalInvestmentRoi,
} from './investmentKpiCore';
import {
  buildHeadlineInvestmentAllocationSlices,
  type HeadlineInvestmentAllocationSlices,
} from './headlineInvestmentAllocation';

/** Platforms + commodities + Sukuk slice totals (matches headline investments bucket decomposition). */
export type HeadlineExposureParts = Pick<
  HeadlinePersonalInvestmentRoi,
  'totalExposureSar' | 'platformsRollupSar' | 'commoditiesValueSar' | 'sukukAssetsValueSar'
>;

function deriveHeadlineExposureParts(
  data: FinancialData,
  sarPerUsd: number,
  investmentsTotalSar: number,
  simulatedPrices: SimulatedPriceMap,
): HeadlineExposureParts {
  const commoditiesValueSar = computePersonalCommoditiesContributionSAR(data, sarPerUsd, simulatedPrices).valueSAR;
  const sukukAssetsValueSar = sumPersonalSukukAssetsSar(data);
  const platformsRollupSar = Math.max(0, investmentsTotalSar - commoditiesValueSar - sukukAssetsValueSar);
  return {
    totalExposureSar: investmentsTotalSar,
    platformsRollupSar,
    commoditiesValueSar,
    sukukAssetsValueSar,
  };
}

export type CanonicalFinancialMetricsInput = {
  data: FinancialData | null | undefined;
  /** CurrencyContext exchange rate (UI). */
  exchangeRate: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  simulatedPrices?: SimulatedPriceMap;
};

export type CanonicalFinancialMetrics = {
  headline: PersonalHeadlineNetWorthResult;
  breakdown: PersonalNetWorthBreakdownSAR;
  kpiSnapshot: DashboardKpiSnapshot | null;
  wealthSummary: WealthSummaryReportModel | null;
  todaySnapshot: TodayBalanceSheetSnapshotSAR;
  investableCashBars: InvestableCashBarRow[];
  /** Sum of platform tradable cash (SAR eq.) — matches Accounts KPI + cockpit investable cash chart. */
  investableCashTotalSar: number;
  sarPerUsd: number;
  netWorth: number;
  liquidCashSar: number;
  nwOptions: PersonalNetWorthOptions | undefined;
  /** Investments hub headline (platforms + commodities + Sukuk) — same as `headline.buckets.investments` with live cash/quotes. */
  investmentExposure: HeadlinePersonalInvestmentRoi | null;
  /** Alias for `investmentExposure.totalExposureSar` / balance-sheet investments bucket. */
  investmentsTotalSar: number;
  /**
   * Exposure slices for allocation charts and Commodities/Assets KPIs.
   * Populated from `investmentExposure` when ledger cash is available; otherwise derived from balance-sheet parts.
   */
  headlineExposureParts: HeadlineExposureParts;
  /** Pie/portfolio rows scaled to `investmentsTotalSar` (Investments Overview, dashboards). */
  investmentAllocation: HeadlineInvestmentAllocationSlices;
};

export function computeCanonicalFinancialMetrics(
  input: CanonicalFinancialMetricsInput,
): CanonicalFinancialMetrics {
  const { data, exchangeRate, getAvailableCashForAccount, simulatedPrices = {} } = input;
  const nwOptions: PersonalNetWorthOptions | undefined = getAvailableCashForAccount
    ? { getAvailableCashForAccount, simulatedPrices }
    : undefined;

  const headline = computePersonalHeadlineNetWorthSar(data, exchangeRate, nwOptions);
  const breakdown = computePersonalNetWorthBreakdownSAR(data, exchangeRate, nwOptions);
  const todaySnapshot = computeTodayBalanceSheetSnapshotSar(data, exchangeRate, nwOptions);

  const kpiSnapshot =
    data && getAvailableCashForAccount
      ? computeDashboardKpiSnapshot(data, exchangeRate, getAvailableCashForAccount, simulatedPrices)
      : null;

  const wealthSummary =
    data && getAvailableCashForAccount
      ? computeWealthSummaryReportModel(data, exchangeRate, getAvailableCashForAccount, simulatedPrices)
      : null;

  let investableCashBars: InvestableCashBarRow[] = [];
  let investableCashTotalSar = 0;
  let investmentExposure: HeadlinePersonalInvestmentRoi | null = null;
  if (data && getAvailableCashForAccount) {
    investmentExposure = computeHeadlinePersonalInvestmentRoiDecimal(
      data,
      headline.sarPerUsd,
      getAvailableCashForAccount,
      simulatedPrices,
    );
  }

  if (data) {
    const scope = getPersonalAccounts(data);
    const allAccounts = data.accounts ?? scope;
    investableCashBars = buildInvestableCashBarsFromInvestmentAccounts(scope, allAccounts, headline.sarPerUsd);
    investableCashTotalSar = sumTradableCashSarFromInvestmentAccounts(scope, allAccounts, headline.sarPerUsd);
  }

  const investmentsTotalSar =
    investmentExposure?.totalExposureSar ?? Math.max(0, headline.buckets.investments);
  const headlineExposureParts: HeadlineExposureParts = investmentExposure
    ? {
        totalExposureSar: investmentExposure.totalExposureSar,
        platformsRollupSar: investmentExposure.platformsRollupSar,
        commoditiesValueSar: investmentExposure.commoditiesValueSar,
        sukukAssetsValueSar: investmentExposure.sukukAssetsValueSar,
      }
    : data
      ? deriveHeadlineExposureParts(data, headline.sarPerUsd, investmentsTotalSar, simulatedPrices)
      : {
          totalExposureSar: 0,
          platformsRollupSar: 0,
          commoditiesValueSar: 0,
          sukukAssetsValueSar: 0,
        };
  const investmentAllocation = buildHeadlineInvestmentAllocationSlices(
    data,
    headlineExposureParts,
    headline.sarPerUsd,
    investableCashTotalSar,
    simulatedPrices,
  );

  return {
    headline,
    breakdown,
    kpiSnapshot,
    wealthSummary,
    todaySnapshot,
    investableCashBars,
    investableCashTotalSar,
    sarPerUsd: headline.sarPerUsd,
    netWorth: headline.netWorth,
    liquidCashSar: kpiSnapshot?.liquidCashSar ?? 0,
    nwOptions,
    investmentExposure,
    investmentsTotalSar,
    headlineExposureParts,
    investmentAllocation,
  };
}
