/**
 * Personal vs managed wealth: "My" net worth and KPIs use only items where owner is empty.
 * Set owner (e.g. "Father") on accounts/assets/liabilities/portfolios/commodities you manage for others.
 */

import type {
  Account,
  Asset,
  Liability,
  InvestmentPortfolio,
  CommodityHolding,
  SukukPosition,
  Transaction,
  FinancialData,
} from '../types';

export interface OwnedItem {
  owner?: string | null;
}

/**
 * True if item counts as personal wealth (include in "my" net worth).
 * Personal = no owner set: undefined, null, empty string, or whitespace-only.
 * Also treats string "null" / "undefined" as empty so API/DB stringification doesn't misclassify.
 */
export function isPersonalWealth(item: OwnedItem | null | undefined): boolean {
  if (!item) return false;
  const o = item.owner;
  if (o == null) return true;
  const s = String(o).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'undefined';
}

/** Personal wealth slice of FinancialData. Used for "my" net worth, KPIs, and engines. */
export interface PersonalWealthData {
  personalAccounts: Account[];
  personalAssets: Asset[];
  personalLiabilities: Liability[];
  personalInvestments: InvestmentPortfolio[];
  personalCommodityHoldings: CommodityHolding[];
  personalSukukPositions: SukukPosition[];
  /** Transactions that hit personal accounts only (for "my" income/expense). */
  personalTransactions: Transaction[];
}

const emptyPersonal: PersonalWealthData = {
  personalAccounts: [],
  personalAssets: [],
  personalLiabilities: [],
  personalInvestments: [],
  personalCommodityHoldings: [],
  personalSukukPositions: [],
  personalTransactions: [],
};

/**
 * Derives personal-only arrays from full financial data.
 * Net worth and all "my" metrics should use these arrays.
 */
export function getPersonalWealthData(data: FinancialData | null | undefined): PersonalWealthData {
  if (!data) return emptyPersonal;

  const personalAccounts = (data.accounts ?? []).filter(isPersonalWealth) as Account[];
  const personalAssets = (data.assets ?? []).filter(isPersonalWealth) as Asset[];
  const personalLiabilities = (data.liabilities ?? []).filter(isPersonalWealth) as Liability[];
  const personalInvestments = (data.investments ?? []).filter(isPersonalWealth) as InvestmentPortfolio[];
  const personalCommodityHoldings = (data.commodityHoldings ?? []).filter(isPersonalWealth) as CommodityHolding[];
  const personalSukukPositions = (data.sukukPositions ?? []) as SukukPosition[];

  const personalAccountIds = new Set(personalAccounts.map((a) => a.id));
  const personalTransactions = (data.transactions ?? []).filter((t) => {
    const raw = t as Transaction & { account_id?: string };
    const accountId = raw.accountId ?? raw.account_id ?? '';
    return accountId.length > 0 && personalAccountIds.has(accountId);
  }) as Transaction[];

  return {
    personalAccounts,
    personalAssets,
    personalLiabilities,
    personalInvestments,
    personalCommodityHoldings,
    personalSukukPositions,
    personalTransactions,
  };
}

export function resolveTransactionAccountId(t: Transaction): string {
  const raw = t as Transaction & { account_id?: string };
  return String(raw.accountId ?? raw.account_id ?? '').trim();
}

/** Centralized accessors for personal data. Use instead of ad-hoc (data as any)?.personalX ?? data?.x. */
export function getPersonalTransactions(data: FinancialData | null | undefined): Transaction[] {
  const p = getPersonalWealthData(data);
  return p.personalTransactions.length > 0 ? p.personalTransactions : (data?.transactions ?? []);
}

/** Alias for KPI / budget / cashflow engines — same rules as {@link getPersonalTransactions}. */
export const getCashflowTransactions = getPersonalTransactions;

/**
 * Cash transactions for account-scoped UI (Transactions page, exports).
 * Uses the full `data.transactions` ledger filtered by visible account ids so shared /
 * household accounts are not dropped when the personal slice is non-empty but narrower.
 */
export function getScopedCashTransactions(
  data: FinancialData | null | undefined,
  accountIds?: Iterable<string>,
): Transaction[] {
  if (!data) return [];
  if (!accountIds) return getPersonalTransactions(data);
  const allowed = new Set(accountIds);
  const pool = (data.transactions ?? []) as Transaction[];
  if (pool.length === 0) {
    return getPersonalTransactions(data).filter((t) => {
      const id = resolveTransactionAccountId(t);
      return id.length === 0 || allowed.has(id);
    });
  }
  return pool.filter((t) => {
    const id = resolveTransactionAccountId(t);
    return id.length > 0 && allowed.has(id);
  });
}

export function getPersonalAccounts(data: FinancialData | null | undefined): Account[] {
  const p = getPersonalWealthData(data);
  return p.personalAccounts.length > 0 ? p.personalAccounts : (data?.accounts ?? []);
}

export function getPersonalAssets(data: FinancialData | null | undefined): Asset[] {
  const p = getPersonalWealthData(data);
  return p.personalAssets.length > 0 ? p.personalAssets : (data?.assets ?? []);
}

export function getPersonalLiabilities(data: FinancialData | null | undefined): Liability[] {
  const p = getPersonalWealthData(data);
  return p.personalLiabilities.length > 0 ? p.personalLiabilities : (data?.liabilities ?? []);
}

export function getPersonalInvestments(data: FinancialData | null | undefined): InvestmentPortfolio[] {
  const p = getPersonalWealthData(data);
  return p.personalInvestments.length > 0 ? p.personalInvestments : (data?.investments ?? []);
}

export function getPersonalCommodityHoldings(data: FinancialData | null | undefined): CommodityHolding[] {
  const p = getPersonalWealthData(data);
  return p.personalCommodityHoldings.length > 0 ? p.personalCommodityHoldings : (data?.commodityHoldings ?? []);
}

export function getPersonalSukukPositions(data: FinancialData | null | undefined): SukukPosition[] {
  const p = getPersonalWealthData(data);
  return p.personalSukukPositions.length > 0 ? p.personalSukukPositions : (data?.sukukPositions ?? []);
}
