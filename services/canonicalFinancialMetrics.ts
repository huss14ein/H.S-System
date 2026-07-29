/**
 * **Single entry point** for headline personal financial metrics (browser, exports, command palette, hooks).
 * React surfaces should prefer `useCanonicalFinancialMetrics()` which calls this with live context inputs.
 */
import type { FinancialData } from '../types';
import {
  computePersonalHeadlineNetWorthSar,
  computePersonalNetWorthBreakdownSAR,
  computeTodayBalanceSheetSnapshotSar,
  type PersonalHeadlineNetWorthResult,
  type PersonalNetWorthBreakdownSAR,
  type PersonalNetWorthOptions,
  type TodayBalanceSheetSnapshotSAR,
} from './personalNetWorth';
import { sumPersonalSukukPositionsSar } from './sukuk/sukukExposure';
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
import {
  buildAvailableLiquiditySnapshot,
  sumGoalReservesSar,
  type AvailableLiquiditySnapshot,
} from './availableLiquidity';
import { computeEmergencyFundMetrics } from '../hooks/useEmergencyFund';
import { sumRewardsFiatSar } from './rewards';
import { computeSalaryInvestmentKpis, type SalaryInvestmentKpis } from './salaryInvestmentKpis';

/** Platforms + commodities + Sukuk slice totals (matches headline investments bucket decomposition). */
export type HeadlineExposureParts = Pick<
  HeadlinePersonalInvestmentRoi,
  'totalExposureSar' | 'platformsRollupSar' | 'commoditiesValueSar' | 'sukukPositionsValueSar'
>;

export function deriveHeadlineExposureParts(
  data: FinancialData,
  sarPerUsd: number,
  investmentsTotalSar: number,
  simulatedPrices: SimulatedPriceMap,
): HeadlineExposureParts {
  const commoditiesValueSar = computePersonalCommoditiesContributionSAR(data, sarPerUsd, simulatedPrices).valueSAR;
  const sukukPositionsValueSar = sumPersonalSukukPositionsSar(data, sarPerUsd);
  const platformsRollupSar = Math.max(0, investmentsTotalSar - commoditiesValueSar - sukukPositionsValueSar);
  return {
    totalExposureSar: investmentsTotalSar,
    platformsRollupSar,
    commoditiesValueSar,
    sukukPositionsValueSar,
  };
}

/**
 * Available liquidity + reserves + rewards memo, computed from the already-known
 * `liquidCashSar`. Emergency floor reuses the shared emergency-fund estimate so the
 * "free to deploy" number matches the Accounts / Dashboard emergency card.
 */
export function computeLiquiditySlices(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  liquidCashSar: number,
  sarPerUsd: number,
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number },
): AvailableLiquiditySnapshot & { rewardsSar: number } {
  const rewardsSar = sumRewardsFiatSar(data, sarPerUsd);
  if (!data) {
    return {
      liquidCashSar: Math.max(0, liquidCashSar || 0),
      reservedLiquiditySar: 0,
      emergencyFundFloorSar: 0,
      availableLiquiditySar: Math.max(0, liquidCashSar || 0),
      rewardsSar,
    };
  }
  let monthlyEssentialExpenseSar = 0;
  let monthsTarget = 6;
  try {
    const ef = computeEmergencyFundMetrics(data, {
      exchangeRate,
      sarPerUsd,
      getAvailableCashForAccount,
      skipHydrate: true,
    });
    monthlyEssentialExpenseSar = ef.monthlyCoreExpenses;
    monthsTarget = ef.targetMonths;
  } catch {
    monthlyEssentialExpenseSar = 0;
  }
  const snapshot = buildAvailableLiquiditySnapshot({
    data,
    liquidCashSar,
    monthlyEssentialExpenseSar,
    monthsTarget,
  });
  return { ...snapshot, rewardsSar };
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
  /** Free-to-deploy liquidity after the emergency floor and goal escrow reserves. */
  availableLiquiditySar: number;
  /** Virtual escrow reserved toward goals / sinking funds (SAR). */
  reservedLiquiditySar: number;
  /** Emergency-fund floor kept untouched (SAR). */
  emergencyFundFloorSar: number;
  /** Rewards/points/cashback memo value (SAR) — never EF or investable cash. */
  rewardsSar: number;
  /** Monthly salary-to-investment attribution bundle. */
  salaryInvestment: SalaryInvestmentKpis | null;
};

/** Dashboard + NetWorthCockpit bundle (skips wealth summary / allocation charts). */
export type DashboardCanonicalMetrics = Pick<
  CanonicalFinancialMetrics,
  | 'headline'
  | 'kpiSnapshot'
  | 'todaySnapshot'
  | 'investableCashBars'
  | 'sarPerUsd'
  | 'netWorth'
  | 'liquidCashSar'
  | 'nwOptions'
>;

export function computeDashboardCanonicalMetrics(
  input: CanonicalFinancialMetricsInput,
): DashboardCanonicalMetrics {
  const { data, exchangeRate, getAvailableCashForAccount, simulatedPrices = {} } = input;
  const nwOptions: PersonalNetWorthOptions | undefined = getAvailableCashForAccount
    ? { getAvailableCashForAccount, simulatedPrices }
    : undefined;

  const headline = computePersonalHeadlineNetWorthSar(data, exchangeRate, nwOptions);
  const todaySnapshot = computeTodayBalanceSheetSnapshotSar(data, exchangeRate, nwOptions);
  const kpiSnapshot =
    data && getAvailableCashForAccount
      ? computeDashboardKpiSnapshot(data, exchangeRate, getAvailableCashForAccount, simulatedPrices)
      : null;

  let investableCashBars: InvestableCashBarRow[] = [];
  if (data) {
    const scope = getPersonalAccounts(data);
    const allAccounts = data.accounts ?? scope;
    investableCashBars = buildInvestableCashBarsFromInvestmentAccounts(scope, allAccounts, headline.sarPerUsd);
  }

  return {
    headline,
    kpiSnapshot,
    todaySnapshot,
    investableCashBars,
    sarPerUsd: headline.sarPerUsd,
    netWorth: headline.netWorth,
    liquidCashSar: kpiSnapshot?.liquidCashSar ?? 0,
    nwOptions,
  };
}

const EMPTY_INVESTMENT_ALLOCATION = (totalSar: number): HeadlineInvestmentAllocationSlices => ({
  totalSar,
  platformHoldingsSar: 0,
  platformCashSar: 0,
  commoditiesSar: 0,
  sukukSar: 0,
  assetClassAllocation: [],
  portfolioAllocation: [],
});

/**
 * Fast path for first paint — headline + KPI only; skips wealth summary, ROI rollup, and allocation charts.
 */
export function buildFastCanonicalFinancialMetrics(
  input: CanonicalFinancialMetricsInput,
): CanonicalFinancialMetrics {
  const dashboard = computeDashboardCanonicalMetrics(input);
  const investmentExposure = dashboard.kpiSnapshot?.headlineInvestmentExposure ?? null;
  const investmentsTotalSar =
    investmentExposure?.totalExposureSar ?? Math.max(0, dashboard.headline.buckets.investments);
  const investableCashTotalSar = dashboard.investableCashBars.reduce((s, row) => s + row.sar, 0);
  const headlineExposureParts: HeadlineExposureParts = investmentExposure
    ? {
        totalExposureSar: investmentExposure.totalExposureSar,
        platformsRollupSar: investmentExposure.platformsRollupSar,
        commoditiesValueSar: investmentExposure.commoditiesValueSar,
        sukukPositionsValueSar: investmentExposure.sukukPositionsValueSar,
      }
    : {
        totalExposureSar: investmentsTotalSar,
        platformsRollupSar: 0,
        commoditiesValueSar: 0,
        sukukPositionsValueSar: 0,
      };
  const reservedLiquiditySar = sumGoalReservesSar(input.data);
  const rewardsSar = sumRewardsFiatSar(input.data, dashboard.sarPerUsd);
  return {
    ...dashboard,
    breakdown: {
      totalAssets: Math.max(0, dashboard.netWorth),
      totalDebt: 0,
      totalReceivable: 0,
      netWorth: dashboard.netWorth,
    },
    wealthSummary: null,
    investableCashTotalSar,
    investmentExposure,
    investmentsTotalSar,
    headlineExposureParts,
    investmentAllocation: EMPTY_INVESTMENT_ALLOCATION(investmentsTotalSar),
    // Fast tier skips the emergency-floor estimate; reserved + rewards are cheap.
    availableLiquiditySar: Math.max(0, (dashboard.liquidCashSar ?? 0) - reservedLiquiditySar),
    reservedLiquiditySar,
    emergencyFundFloorSar: 0,
    rewardsSar,
    // Salary-invest is multi-month history — defer to extend / async path (no first-paint block).
    salaryInvestment: null,
  };
}

/** Expensive slices only — reuses dashboard headline/KPI from phase 1. */
export function extendCanonicalFinancialMetrics(
  dashboard: DashboardCanonicalMetrics,
  input: CanonicalFinancialMetricsInput,
): CanonicalFinancialMetrics {
  const { data, exchangeRate, getAvailableCashForAccount, simulatedPrices = {} } = input;
  const nwOptions: PersonalNetWorthOptions | undefined = getAvailableCashForAccount
    ? { getAvailableCashForAccount, simulatedPrices }
    : undefined;

  const breakdown = computePersonalNetWorthBreakdownSAR(data, exchangeRate, nwOptions);
  const wealthSummary =
    data && getAvailableCashForAccount
      ? computeWealthSummaryReportModel(data, exchangeRate, getAvailableCashForAccount, simulatedPrices)
      : null;

  let investableCashTotalSar = 0;
  let investmentExposure: HeadlinePersonalInvestmentRoi | null = null;
  if (data && getAvailableCashForAccount) {
    investmentExposure = computeHeadlinePersonalInvestmentRoiDecimal(
      data,
      dashboard.sarPerUsd,
      getAvailableCashForAccount,
      simulatedPrices,
    );
  }

  if (data) {
    const scope = getPersonalAccounts(data);
    const allAccounts = data.accounts ?? scope;
    investableCashTotalSar = sumTradableCashSarFromInvestmentAccounts(scope, allAccounts, dashboard.sarPerUsd);
  }

  const investmentsTotalSar =
    investmentExposure?.totalExposureSar ?? Math.max(0, dashboard.headline.buckets.investments);
  const headlineExposureParts: HeadlineExposureParts = investmentExposure
    ? {
        totalExposureSar: investmentExposure.totalExposureSar,
        platformsRollupSar: investmentExposure.platformsRollupSar,
        commoditiesValueSar: investmentExposure.commoditiesValueSar,
        sukukPositionsValueSar: investmentExposure.sukukPositionsValueSar,
      }
    : data
      ? deriveHeadlineExposureParts(data, dashboard.sarPerUsd, investmentsTotalSar, simulatedPrices)
      : {
          totalExposureSar: 0,
          platformsRollupSar: 0,
          commoditiesValueSar: 0,
          sukukPositionsValueSar: 0,
        };
  const investmentAllocation = buildHeadlineInvestmentAllocationSlices(
    data,
    headlineExposureParts,
    dashboard.sarPerUsd,
    investableCashTotalSar,
    simulatedPrices,
  );

  return mergeExtendedIntoDashboard(
    dashboard,
    {
      breakdown,
      wealthSummary,
      investableCashTotalSar,
      investmentExposure,
      investmentsTotalSar,
      headlineExposureParts,
      investmentAllocation,
      salaryInvestment: data ? computeSalaryInvestmentKpis(data, exchangeRate) : null,
    },
    computeLiquiditySlices(
      data,
      exchangeRate,
      dashboard.liquidCashSar,
      dashboard.sarPerUsd,
      getAvailableCashForAccount,
    ),
  );
}

export function mergeExtendedIntoDashboard(
  dashboard: DashboardCanonicalMetrics,
  extended: Pick<
    CanonicalFinancialMetrics,
    | 'breakdown'
    | 'wealthSummary'
    | 'investableCashTotalSar'
    | 'investmentExposure'
    | 'investmentsTotalSar'
    | 'headlineExposureParts'
    | 'investmentAllocation'
    | 'salaryInvestment'
  >,
  liquidity?: AvailableLiquiditySnapshot & { rewardsSar: number },
): CanonicalFinancialMetrics {
  const reservedLiquiditySar = liquidity?.reservedLiquiditySar ?? 0;
  const emergencyFundFloorSar = liquidity?.emergencyFundFloorSar ?? 0;
  const availableLiquiditySar =
    liquidity?.availableLiquiditySar ??
    Math.max(0, (dashboard.liquidCashSar ?? 0) - reservedLiquiditySar - emergencyFundFloorSar);
  return {
    headline: dashboard.headline,
    breakdown: extended.breakdown,
    kpiSnapshot: dashboard.kpiSnapshot,
    wealthSummary: extended.wealthSummary,
    todaySnapshot: dashboard.todaySnapshot,
    investableCashBars: dashboard.investableCashBars,
    investableCashTotalSar: extended.investableCashTotalSar,
    sarPerUsd: dashboard.sarPerUsd,
    netWorth: dashboard.netWorth,
    liquidCashSar: dashboard.liquidCashSar,
    nwOptions: dashboard.nwOptions,
    investmentExposure: extended.investmentExposure,
    investmentsTotalSar: extended.investmentsTotalSar,
    headlineExposureParts: extended.headlineExposureParts,
    investmentAllocation: extended.investmentAllocation,
    availableLiquiditySar,
    reservedLiquiditySar,
    emergencyFundFloorSar,
    rewardsSar: liquidity?.rewardsSar ?? 0,
    salaryInvestment: extended.salaryInvestment,
  };
}

/** Derive dashboard bundle from full canonical metrics (avoids duplicate headline/KPI compute). */
export function pickDashboardCanonicalMetrics(full: CanonicalFinancialMetrics): DashboardCanonicalMetrics {
  return {
    headline: full.headline,
    kpiSnapshot: full.kpiSnapshot,
    todaySnapshot: full.todaySnapshot,
    investableCashBars: full.investableCashBars,
    sarPerUsd: full.sarPerUsd,
    netWorth: full.netWorth,
    liquidCashSar: full.liquidCashSar,
    nwOptions: full.nwOptions,
  };
}

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
        sukukPositionsValueSar: investmentExposure.sukukPositionsValueSar,
      }
    : data
      ? deriveHeadlineExposureParts(data, headline.sarPerUsd, investmentsTotalSar, simulatedPrices)
      : {
          totalExposureSar: 0,
          platformsRollupSar: 0,
          commoditiesValueSar: 0,
          sukukPositionsValueSar: 0,
        };
  const investmentAllocation = buildHeadlineInvestmentAllocationSlices(
    data,
    headlineExposureParts,
    headline.sarPerUsd,
    investableCashTotalSar,
    simulatedPrices,
  );

  const liquidCashSar = kpiSnapshot?.liquidCashSar ?? 0;
  const liquidity = computeLiquiditySlices(
    data,
    exchangeRate,
    liquidCashSar,
    headline.sarPerUsd,
    getAvailableCashForAccount,
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
    liquidCashSar,
    nwOptions,
    investmentExposure,
    investmentsTotalSar,
    headlineExposureParts,
    investmentAllocation,
    availableLiquiditySar: liquidity.availableLiquiditySar,
    reservedLiquiditySar: liquidity.reservedLiquiditySar,
    emergencyFundFloorSar: liquidity.emergencyFundFloorSar,
    rewardsSar: liquidity.rewardsSar,
    salaryInvestment: data ? computeSalaryInvestmentKpis(data, exchangeRate) : null,
  };
}
