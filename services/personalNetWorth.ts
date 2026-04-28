import type { FinancialData } from '../types';
import { getAllInvestmentsValueInSAR, resolveSarPerUsd, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalAssets, getPersonalLiabilities, getPersonalCommodityHoldings, getPersonalInvestments } from '../utils/wealthScope';
import { hydrateSarPerUsdDailySeries } from './fxDailySeries';

export type PersonalNetWorthOptions = {
  /** When set, cash sitting in investment accounts (ledger) is included in assets — matches Dashboard ROI / deployable cash. */
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
};

export type PersonalNetWorthBreakdownSAR = {
  /** Physical + financial assets (SAR), excluding receivables */
  totalAssets: number;
  totalDebt: number;
  totalReceivable: number;
  netWorth: number;
};

/** Stacked-chart buckets: sum to the same net worth as `computePersonalNetWorthBreakdownSAR` for the current month. */
export type PersonalNetWorthChartBucketsSAR = {
  cash: number;
  investments: number;
  /** Recorded physical assets + commodities (SAR) */
  physicalAndCommodities: number;
  receivables: number;
  /** Negative total debt for signed stack / liability band */
  liabilities: number;
  netWorth: number;
};

type BalanceSheetSlices = {
  accounts: ReturnType<typeof getPersonalAccounts>;
  assets: ReturnType<typeof getPersonalAssets>;
  liabilities: ReturnType<typeof getPersonalLiabilities>;
  commodityHoldings: ReturnType<typeof getPersonalCommodityHoldings>;
  investments: ReturnType<typeof getPersonalInvestments>;
};

/** Total SAR value of personal Sukuk rows under Assets (for snapshot audit / UI). */
export function sumPersonalSukukAssetsSar(data: FinancialData | null | undefined): number {
  if (!data) return 0;
  return partitionPhysicalAssetsVsSukukSar(getPersonalAssets(data)).sukukSar;
}

/** Sukuk tracked under Assets is fixed-income / capital-markets exposure — bucket with Investments for charts (aligned with Investments workspace). */
function partitionPhysicalAssetsVsSukukSar(
  assets: Array<{ type?: string; value?: number }>,
): { physicalSar: number; sukukSar: number } {
  let physicalSar = 0;
  let sukukSar = 0;
  for (const asset of assets) {
    const v = Math.max(0, Number(asset?.value) || 0);
    if (asset?.type === 'Sukuk') sukukSar += v;
    else physicalSar += v;
  }
  return { physicalSar, sukukSar };
}

function accumulateBalanceSheetSlices(
  slices: BalanceSheetSlices,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
) {
  const { accounts, assets, liabilities, commodityHoldings, investments } = slices;

  const cashSavingsAccounts = accounts.filter(
    (a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings'
  );
  const cashAndSavingsPositive = cashSavingsAccounts
    .filter((a: { balance?: number }) => (a.balance ?? 0) > 0)
    .reduce((sum: number, acc: { balance?: number; currency?: string }) => {
      const cur = acc.currency === 'USD' ? 'USD' : 'SAR';
      return sum + toSAR(acc.balance ?? 0, cur as 'SAR' | 'USD', exchangeRate);
    }, 0);
  const cashAndSavingsNegative = cashSavingsAccounts
    .filter((a: { balance?: number }) => (a.balance ?? 0) < 0)
    .reduce((sum: number, acc: { balance?: number; currency?: string }) => {
      const cur = acc.currency === 'USD' ? 'USD' : 'SAR';
      return sum + Math.abs(toSAR(acc.balance ?? 0, cur as 'SAR' | 'USD', exchangeRate));
    }, 0);

  const totalDebt =
    liabilities
      .filter((l: { amount?: number }) => (l.amount ?? 0) < 0)
      .reduce((sum: number, liab: { amount?: number }) => sum + Math.abs(liab.amount ?? 0), 0) +
    accounts
      .filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0)
      .reduce((sum: number, acc: { balance?: number }) => sum + Math.abs(acc.balance ?? 0), 0) +
    cashAndSavingsNegative;

  const totalReceivable = liabilities
    .filter((l: { amount?: number }) => (l.amount ?? 0) > 0)
    .reduce((sum: number, liab: { amount?: number }) => sum + (liab.amount ?? 0), 0);

  const totalCommodities = commodityHoldings.reduce(
    (sum: number, ch: { currentValue?: number }) => sum + (ch.currentValue ?? 0),
    0
  );
  const { physicalSar: physicalAssetsSar, sukukSar: sukukAssetsSar } = partitionPhysicalAssetsVsSukukSar(assets);
  const totalInvestmentsValue = getAllInvestmentsValueInSAR(investments, exchangeRate);
  let brokerageCashSAR = 0;
  if (options?.getAvailableCashForAccount) {
    const getCash = options.getAvailableCashForAccount;
    accounts
      .filter((a: { type?: string }) => a.type === 'Investment')
      .forEach((a: { id: string }) => {
        brokerageCashSAR += tradableCashBucketToSAR(getCash(a.id), exchangeRate);
      });
  }

  return {
    cashAndSavingsPositive,
    totalDebt,
    totalReceivable,
    totalCommodities,
    physicalAssetsSar,
    sukukAssetsSar,
    totalInvestmentsValue,
    brokerageCashSAR,
  };
}

function accumulatePersonalBalanceSheet(
  data: FinancialData,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
) {
  return accumulateBalanceSheetSlices(
    {
      accounts: getPersonalAccounts(data),
      assets: getPersonalAssets(data),
      liabilities: getPersonalLiabilities(data),
      commodityHoldings: getPersonalCommodityHoldings(data),
      investments: getPersonalInvestments(data),
    },
    exchangeRate,
    options
  );
}

/**
 * Balance-sheet buckets for **all** accounts/assets (household-inclusive). Use for Analysis / full-ledger views.
 */
export function computeAllNetWorthChartBucketsSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
): PersonalNetWorthChartBucketsSAR {
  if (!data) {
    return { cash: 0, investments: 0, physicalAndCommodities: 0, receivables: 0, liabilities: 0, netWorth: 0 };
  }
  const b = accumulateBalanceSheetSlices(
    {
      accounts: data.accounts ?? [],
      assets: data.assets ?? [],
      liabilities: data.liabilities ?? [],
      commodityHoldings: data.commodityHoldings ?? [],
      investments: data.investments ?? [],
    },
    exchangeRate,
    options
  );
  const cash = b.cashAndSavingsPositive;
  const investments = b.totalInvestmentsValue + b.brokerageCashSAR + b.sukukAssetsSar;
  const physicalAndCommodities = b.physicalAssetsSar + b.totalCommodities;
  const receivables = b.totalReceivable;
  const liabilities = -b.totalDebt;
  const netWorth = cash + investments + physicalAndCommodities + receivables + liabilities;
  return { cash, investments, physicalAndCommodities, receivables, liabilities, netWorth };
}

/**
 * Personal-scope balance sheet pieces in **SAR** (same scope as net worth).
 */
export function computePersonalNetWorthBreakdownSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
): PersonalNetWorthBreakdownSAR {
  if (!data) {
    return { totalAssets: 0, totalDebt: 0, totalReceivable: 0, netWorth: 0 };
  }
  const b = accumulatePersonalBalanceSheet(data, exchangeRate, options);
  const totalAssets =
    b.physicalAssetsSar +
    b.cashAndSavingsPositive +
    b.totalCommodities +
    b.totalInvestmentsValue +
    b.brokerageCashSAR +
    b.sukukAssetsSar;

  const netWorth = totalAssets - b.totalDebt + b.totalReceivable;
  return { totalAssets, totalDebt: b.totalDebt, totalReceivable: b.totalReceivable, netWorth };
}

/**
 * Chart buckets aligned with headline personal net worth (Summary / Dashboard).
 * Past months in the composition chart still use a simplified backward model; **today’s** row matches the balance sheet.
 */
export function computePersonalNetWorthChartBucketsSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
): PersonalNetWorthChartBucketsSAR {
  if (!data) {
    return { cash: 0, investments: 0, physicalAndCommodities: 0, receivables: 0, liabilities: 0, netWorth: 0 };
  }
  const b = accumulatePersonalBalanceSheet(data, exchangeRate, options);
  const cash = b.cashAndSavingsPositive;
  const investments = b.totalInvestmentsValue + b.brokerageCashSAR + b.sukukAssetsSar;
  const physicalAndCommodities = b.physicalAssetsSar + b.totalCommodities;
  const receivables = b.totalReceivable;
  const liabilities = -b.totalDebt;
  const netWorth = cash + investments + physicalAndCommodities + receivables + liabilities;
  return { cash, investments, physicalAndCommodities, receivables, liabilities, netWorth };
}

/**
 * Raw personal-scope net worth in SAR from a **pre-resolved** SAR/USD rate.
 * For any UI that must match Dashboard / Summary / cockpit, prefer **`computePersonalHeadlineNetWorthSar`**
 * (it runs `hydrateSarPerUsdDailySeries` + `resolveSarPerUsd` so FX matches headline KPIs).
 */
export function computePersonalNetWorthSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
): number {
  return computePersonalNetWorthBreakdownSAR(data, exchangeRate, options).netWorth;
}

export type PersonalHeadlineNetWorthResult = {
  /** Same figure as KPI “My net worth”, Net worth cockpit headline, and wealth summary snapshot. */
  netWorth: number;
  buckets: PersonalNetWorthChartBucketsSAR;
  /** Resolved SAR/USD after hydrate — reuse for any follow-on SAR conversions in the same render. */
  sarPerUsd: number;
};

/**
 * **Single source of truth** for personal-scope headline net worth (SAR) and stacked buckets.
 * Always pass the **same** `data` (DataContext) and **CurrencyContext `exchangeRate`** everywhere
 * so Dashboard, Summary, Net worth cockpit, and exports match.
 *
 * Uses one consistent FX path (`hydrateSarPerUsdDailySeries` + `resolveSarPerUsd`) — do **not**
 * substitute a calendar-day spot for headline NW (that caused cockpit vs KPI drift).
 */
export function computePersonalHeadlineNetWorthSar(
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
  options?: PersonalNetWorthOptions,
): PersonalHeadlineNetWorthResult {
  if (!data) {
    const fallback = Number.isFinite(uiExchangeRate) && uiExchangeRate > 0 ? uiExchangeRate : 3.75;
    return {
      netWorth: 0,
      buckets: { cash: 0, investments: 0, physicalAndCommodities: 0, receivables: 0, liabilities: 0, netWorth: 0 },
      sarPerUsd: fallback,
    };
  }
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const sarPerUsd = resolveSarPerUsd(data, uiExchangeRate);
  const buckets = computePersonalNetWorthChartBucketsSAR(data, sarPerUsd, options);
  return { netWorth: buckets.netWorth, buckets, sarPerUsd };
}
