import type {
  CanonicalFinancialMetricsInput,
  DashboardCanonicalMetrics,
  CanonicalFinancialMetrics,
  HeadlineExposureParts,
} from './canonicalFinancialMetrics';
import {
  buildFastCanonicalFinancialMetrics,
  deriveHeadlineExposureParts,
  mergeExtendedIntoDashboard,
} from './canonicalFinancialMetrics';
import { computePersonalNetWorthBreakdownSAR, type PersonalNetWorthOptions } from './personalNetWorth';
import { computeWealthSummaryReportModel } from './wealthSummaryReportModel';
import { getPersonalAccounts } from '../utils/wealthScope';
import { sumTradableCashSarFromInvestmentAccounts } from './investmentCashLedger';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
  type HeadlinePersonalInvestmentRoi,
} from './investmentKpiCore';
import { buildHeadlineInvestmentAllocationSlices } from './headlineInvestmentAllocation';
import { waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';

export type CanonicalMetricsAbortSignal = {
  shouldAbort?: () => boolean;
};

async function checkpoint(signal?: CanonicalMetricsAbortSignal): Promise<boolean> {
  if (signal?.shouldAbort?.()) return true;
  await waitUntilBackgroundWorkResumed();
  if (signal?.shouldAbort?.()) return true;
  await yieldToMain(0);
  return !!signal?.shouldAbort?.();
}

/** Phase 1 — headline + KPI for fast route paint. */
export function computeFastCanonicalFinancialMetrics(
  input: CanonicalFinancialMetricsInput,
): CanonicalFinancialMetrics {
  return buildFastCanonicalFinancialMetrics(input);
}

/** Phase 2 with yields between wealth summary, ROI rollup, and allocation. */
export async function extendCanonicalFinancialMetricsAsync(
  dashboard: DashboardCanonicalMetrics,
  input: CanonicalFinancialMetricsInput,
  signal?: CanonicalMetricsAbortSignal,
): Promise<CanonicalFinancialMetrics | null> {
  const { data, exchangeRate, getAvailableCashForAccount, simulatedPrices = {} } = input;
  const nwOptions: PersonalNetWorthOptions | undefined = getAvailableCashForAccount
    ? { getAvailableCashForAccount, simulatedPrices }
    : undefined;

  if (await checkpoint(signal)) return null;
  const breakdown = computePersonalNetWorthBreakdownSAR(data, exchangeRate, nwOptions);

  if (await checkpoint(signal)) return null;
  const wealthSummary =
    data && getAvailableCashForAccount
      ? computeWealthSummaryReportModel(data, exchangeRate, getAvailableCashForAccount, simulatedPrices)
      : null;

  if (await checkpoint(signal)) return null;
  let investmentExposure: HeadlinePersonalInvestmentRoi | null = null;
  if (data && getAvailableCashForAccount) {
    investmentExposure = computeHeadlinePersonalInvestmentRoiDecimal(
      data,
      dashboard.sarPerUsd,
      getAvailableCashForAccount,
      simulatedPrices,
    );
  }

  let investableCashTotalSar = 0;
  if (data) {
    const scope = getPersonalAccounts(data);
    const allAccounts = data.accounts ?? scope;
    investableCashTotalSar = sumTradableCashSarFromInvestmentAccounts(scope, allAccounts, dashboard.sarPerUsd);
  }

  if (await checkpoint(signal)) return null;
  const investmentsTotalSar =
    investmentExposure?.totalExposureSar ?? Math.max(0, dashboard.headline.buckets.investments);
  const headlineExposureParts: HeadlineExposureParts = investmentExposure
    ? {
        totalExposureSar: investmentExposure.totalExposureSar,
        platformsRollupSar: investmentExposure.platformsRollupSar,
        commoditiesValueSar: investmentExposure.commoditiesValueSar,
        sukukAssetsValueSar: investmentExposure.sukukAssetsValueSar,
      }
    : data
      ? deriveHeadlineExposureParts(data, dashboard.sarPerUsd, investmentsTotalSar, simulatedPrices)
      : {
          totalExposureSar: 0,
          platformsRollupSar: 0,
          commoditiesValueSar: 0,
          sukukAssetsValueSar: 0,
        };
  const investmentAllocation = buildHeadlineInvestmentAllocationSlices(
    data,
    headlineExposureParts,
    dashboard.sarPerUsd,
    investableCashTotalSar,
    simulatedPrices,
  );

  return mergeExtendedIntoDashboard(dashboard, {
    breakdown,
    wealthSummary,
    investableCashTotalSar,
    investmentExposure,
    investmentsTotalSar,
    headlineExposureParts,
    investmentAllocation,
  });
}

/** Full bundle in two idle-friendly phases. */
export async function computeCanonicalFinancialMetricsPhasedAsync(
  input: CanonicalFinancialMetricsInput,
  signal?: CanonicalMetricsAbortSignal,
): Promise<CanonicalFinancialMetrics | null> {
  const fast = computeFastCanonicalFinancialMetrics(input);
  const dashboard: DashboardCanonicalMetrics = {
    headline: fast.headline,
    kpiSnapshot: fast.kpiSnapshot,
    todaySnapshot: fast.todaySnapshot,
    investableCashBars: fast.investableCashBars,
    sarPerUsd: fast.sarPerUsd,
    netWorth: fast.netWorth,
    liquidCashSar: fast.liquidCashSar,
    nwOptions: fast.nwOptions,
  };
  const extended = await extendCanonicalFinancialMetricsAsync(dashboard, input, signal);
  return extended ?? fast;
}
