import type { FinancialData } from '../types';
import { getAllInvestmentsValueInSAR } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalAssets, getPersonalLiabilities, getPersonalCommodityHoldings, getPersonalInvestments } from '../utils/wealthScope';

export type PersonalNetWorthBreakdownSAR = {
  /** Physical + financial assets (SAR), excluding receivables */
  totalAssets: number;
  totalDebt: number;
  totalReceivable: number;
  netWorth: number;
};

/**
 * Personal-scope balance sheet pieces in **SAR** (same scope as net worth).
 */
export function computePersonalNetWorthBreakdownSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number
): PersonalNetWorthBreakdownSAR {
  if (!data) {
    return { totalAssets: 0, totalDebt: 0, totalReceivable: 0, netWorth: 0 };
  }
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
    .reduce((sum: number, acc: { balance?: number }) => sum + (acc.balance ?? 0), 0);
  const cashAndSavingsNegative = cashSavingsAccounts
    .filter((a: { balance?: number }) => (a.balance ?? 0) < 0)
    .reduce((sum: number, acc: { balance?: number }) => sum + Math.abs(acc.balance ?? 0), 0);

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
  const totalInvestmentsValue = getAllInvestmentsValueInSAR(investments, exchangeRate);
  const totalAssets =
    assets.reduce((sum: number, asset: { value?: number }) => sum + (asset.value ?? 0), 0) +
    cashAndSavingsPositive +
    totalCommodities +
    totalInvestmentsValue;

  const netWorth = totalAssets - totalDebt + totalReceivable;
  return { totalAssets, totalDebt, totalReceivable, netWorth };
}

/**
 * Personal-scope net worth in **SAR** — same formula as **Dashboard** and **Summary**
 * (cash/savings, physical assets, commodities, investments converted to SAR, minus debt, plus receivables).
 */
export function computePersonalNetWorthSAR(
  data: FinancialData | null | undefined,
  exchangeRate: number
): number {
  return computePersonalNetWorthBreakdownSAR(data, exchangeRate).netWorth;
}
