import type { FinancialData } from '../types';
import { getAllInvestmentsValueInSAR, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalAssets, getPersonalLiabilities, getPersonalCommodityHoldings, getPersonalInvestments } from '../utils/wealthScope';

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

function accumulatePersonalBalanceSheet(
  data: FinancialData,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
) {
  const accounts = getPersonalAccounts(data);
  const assets = getPersonalAssets(data);
  const liabilities = getPersonalLiabilities(data);
  const commodityHoldings = getPersonalCommodityHoldings(data);
  const investments = getPersonalInvestments(data);

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
  const assetsSum = assets.reduce((sum: number, asset: { value?: number }) => sum + (asset.value ?? 0), 0);
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
    assetsSum,
    totalInvestmentsValue,
    brokerageCashSAR,
  };
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
    b.assetsSum +
    b.cashAndSavingsPositive +
    b.totalCommodities +
    b.totalInvestmentsValue +
    b.brokerageCashSAR;

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
  const investments = b.totalInvestmentsValue + b.brokerageCashSAR;
  const physicalAndCommodities = b.assetsSum + b.totalCommodities;
  const receivables = b.totalReceivable;
  const liabilities = -b.totalDebt;
  const netWorth = cash + investments + physicalAndCommodities + receivables + liabilities;
  return { cash, investments, physicalAndCommodities, receivables, liabilities, netWorth };
}

/**
 * Personal-scope net worth in **SAR** — same formula as **Dashboard** and **Summary**
 * (cash/savings, physical assets, commodities, investments converted to SAR, minus debt, plus receivables).
 */
export function computePersonalNetWorthSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  options?: PersonalNetWorthOptions
): number {
  return computePersonalNetWorthBreakdownSAR(data, exchangeRate, options).netWorth;
}
