import type { Account, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { tradableCashBucketToSAR } from '../utils/currencyMath';
import { deltaForInvestmentTrade } from './investmentBalanceDelta';
import { inferInvestmentTransactionCurrency, resolveCanonicalAccountId, resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';

function bucketCashScore(bucket: { SAR: number; USD: number }): number {
  return Math.abs(Number(bucket.SAR) || 0) + Math.abs(Number(bucket.USD) || 0);
}

/**
 * Platform cash from the **Investment** row in Accounts (`balance` + `currency`).
 * This is the user-visible broker / platform cash balance; trade limits and KPI deployable cash use this,
 * not a pure replay of investment transactions (which can drift when flows are incomplete).
 */
export function brokerCashBucketsFromInvestmentAccount(
  acc: Pick<Account, 'type' | 'balance' | 'currency'> | undefined | null,
): { SAR: number; USD: number } {
  if (!acc || acc.type !== 'Investment') return { SAR: 0, USD: 0 };
  const bal = Number(acc.balance);
  const n = Number.isFinite(bal) ? bal : 0;
  const cur: TradeCurrency = acc.currency === 'USD' ? 'USD' : 'SAR';
  return cur === 'USD' ? { SAR: 0, USD: n } : { SAR: n, USD: 0 };
}

/** Canonical investment account id → SAR/USD buckets from each platform's `balance`. */
export function computeBrokerCashByAccountMap(accounts: Account[]): Record<string, { SAR: number; USD: number }> {
  const map: Record<string, { SAR: number; USD: number }> = {};
  for (const acc of accounts) {
    if (acc.type !== 'Investment') continue;
    const id = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    if (!id) continue;
    const next = brokerCashBucketsFromInvestmentAccount(acc);
    const prev = map[id];
    if (!prev || bucketCashScore(next) > bucketCashScore(prev)) {
      map[id] = next;
    }
  }
  return map;
}

/**
 * Resolve the Investment account row whose `balance` should drive tradable cash.
 * Prefers a direct id match (same row as Accounts cards) before canonical alias resolution.
 */
export function resolveInvestmentAccountForCashLookup(
  accountId: string | undefined,
  accounts: Account[],
): Account | undefined {
  const trimmed = (accountId ?? '').trim();
  if (!trimmed) return undefined;
  const direct = accounts.find((a) => a.id === trimmed && a.type === 'Investment');
  if (direct) return direct;
  const canonical = resolveCanonicalAccountId(trimmed, accounts);
  if (!canonical) return undefined;
  return accounts.find((a) => a.id === canonical && a.type === 'Investment');
}

/** Tradable cash buckets for one platform — uses each account row's stored `balance`. */
export function getTradableCashBucketsForAccount(
  accountId: string,
  accounts: Account[],
): { SAR: number; USD: number } {
  return brokerCashBucketsFromInvestmentAccount(resolveInvestmentAccountForCashLookup(accountId, accounts));
}

/**
 * Sum tradable cash (SAR eq.) for every Investment account in `scopeAccounts`.
 * Each platform's stored balance counts once (canonical dedupe via `allAccounts`).
 */
export function sumTradableCashSarFromInvestmentAccounts(
  scopeAccounts: Account[],
  allAccounts: Account[],
  sarPerUsd: number,
): number {
  const allForCanon = allAccounts.length ? allAccounts : scopeAccounts;
  const merged = new Map<string, { SAR: number; USD: number }>();
  for (const acc of scopeAccounts) {
    if (acc.type !== 'Investment') continue;
    /** Prefer the live row from `allAccounts` (same id) so deployable cash tracks balance updates. */
    const row = allForCanon.find((a) => a.id === acc.id) ?? acc;
    const id = resolveCanonicalAccountId(row.id, allForCanon) ?? row.id;
    if (!id) continue;
    const next = brokerCashBucketsFromInvestmentAccount(row);
    const prev = merged.get(id);
    if (!prev || bucketCashScore(next) > bucketCashScore(prev)) {
      merged.set(id, next);
    }
  }
  let sum = 0;
  for (const bucket of merged.values()) {
    sum += tradableCashBucketToSAR(bucket, sarPerUsd);
  }
  return sum;
}

export type InvestableCashBarRow = { accountId: string; label: string; sar: number };

/**
 * Per-platform investable cash bars (Dashboard cockpit, Accounts) — same dedupe + balance lookup as
 * {@link sumTradableCashSarFromInvestmentAccounts}.
 */
export function buildInvestableCashBarsFromInvestmentAccounts(
  scopeAccounts: Account[],
  allAccounts: Account[],
  sarPerUsd: number,
  options?: { maxBars?: number; labelMaxLen?: number },
): InvestableCashBarRow[] {
  const allForCanon = allAccounts.length ? allAccounts : scopeAccounts;
  const merged = new Map<string, InvestableCashBarRow>();
  const labelMaxLen = options?.labelMaxLen ?? 14;

  for (const acc of scopeAccounts) {
    if (acc.type !== 'Investment') continue;
    const row = allForCanon.find((a) => a.id === acc.id) ?? acc;
    const id = resolveCanonicalAccountId(row.id, allForCanon) ?? row.id;
    if (!id) continue;
    const sar = Math.max(0, tradableCashBucketToSAR(brokerCashBucketsFromInvestmentAccount(row), sarPerUsd));
    const next: InvestableCashBarRow = {
      accountId: id,
      label: (row.name || 'Platform').slice(0, labelMaxLen),
      sar,
    };
    const prev = merged.get(id);
    if (!prev || next.sar > prev.sar) merged.set(id, next);
  }

  return [...merged.values()]
    .filter((r) => r.sar > 0.5)
    .sort((a, b) => b.sar - a.sar)
    .slice(0, options?.maxBars ?? 8);
}

/** Replay of investment transactions into SAR/USD buckets (reconciliation / audits — not primary available cash). */
export function computeAvailableCashByAccountMap(args: {
  accounts: Account[];
  investments: InvestmentPortfolio[];
  investmentTransactions: InvestmentTransaction[];
  sarPerUsd?: number;
}): Record<string, { SAR: number; USD: number }> {
  const { accounts, investments, investmentTransactions } = args;
  const sarPerUsd = Number(args.sarPerUsd);
  const fx = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : 3.75;
  const map: Record<string, { SAR: number; USD: number }> = {};
  const txCountByAccount: Record<string, number> = {};

  accounts.forEach((acc) => {
    if (acc.type !== 'Investment') return;
    const accId = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    if (!accId) return;
    if (!(accId in map)) map[accId] = { SAR: 0, USD: 0 };
    txCountByAccount[accId] = 0;
  });

  const orderedTransactions = [...investmentTransactions]
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => {
      const ta = Date.parse(String((a.t as any).created_at ?? (a.t as any).createdAt ?? a.t.date ?? ''));
      const tb = Date.parse(String((b.t as any).created_at ?? (b.t as any).createdAt ?? b.t.date ?? ''));
      const va = Number.isFinite(ta) ? ta : 0;
      const vb = Number.isFinite(tb) ? tb : 0;
      if (va !== vb) return va - vb;
      // Preserve caller order for exact timestamp ties.
      return a.idx - b.idx;
    })
    .map((x) => x.t);

  orderedTransactions.forEach((t) => {
    const rawAccountId = resolveInvestmentTransactionAccountId(
      t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
      accounts,
      investments,
    );
    const accId = resolveCanonicalAccountId(rawAccountId, accounts) ?? rawAccountId;
    if (!accId || !(accId in map)) return;
    const amount = getInvestmentTransactionCashAmount(t as any);
    if (!(amount > 0)) return;
    const signed = deltaForInvestmentTrade(String(t.type ?? ''), amount);
    if (!Number.isFinite(signed) || signed === 0) return;
    const cur = inferInvestmentTransactionCurrency(t, accounts, investments);
    const bucket = map[accId];
    if (cur === 'USD') {
      if (signed >= 0) {
        bucket.USD += signed;
      } else {
        let spendUsd = -signed;
        const usdUsed = Math.min(bucket.USD, spendUsd);
        bucket.USD -= usdUsed;
        spendUsd -= usdUsed;
        if (spendUsd > 0) {
          const sarNeeded = spendUsd * fx;
          const sarUsed = Math.min(bucket.SAR, sarNeeded);
          bucket.SAR -= sarUsed;
          spendUsd -= sarUsed / fx;
        }
        if (spendUsd > 0) bucket.USD -= spendUsd;
      }
    } else {
      if (signed >= 0) {
        bucket.SAR += signed;
      } else {
        let spendSar = -signed;
        const sarUsed = Math.min(bucket.SAR, spendSar);
        bucket.SAR -= sarUsed;
        spendSar -= sarUsed;
        if (spendSar > 0) {
          const usdNeeded = spendSar / fx;
          const usdUsed = Math.min(bucket.USD, usdNeeded);
          bucket.USD -= usdUsed;
          spendSar -= usdUsed * fx;
        }
        if (spendSar > 0) bucket.SAR -= spendSar;
      }
    }
    txCountByAccount[accId] = (txCountByAccount[accId] ?? 0) + 1;
  });

  accounts.forEach((acc) => {
    if (acc.type !== 'Investment') return;
    const accId = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    if (!accId || !(accId in map)) return;
    if ((txCountByAccount[accId] ?? 0) > 0) return;
    const openingBalance = Number(acc.balance ?? 0);
    if (!Number.isFinite(openingBalance) || openingBalance === 0) return;
    const baseCur: TradeCurrency = acc.currency === 'USD' ? 'USD' : 'SAR';
    map[accId][baseCur] += openingBalance;
  });

  return map;
}
