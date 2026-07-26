/**
 * Rewards / points / cashback domain helpers (KSA resident wealth OS).
 * Unredeemed points are memo / optional NW Rewards bucket — never income, EF, or investable cash.
 */

import type { FinancialData, RewardsAccount, RewardsLot, RewardsTransaction } from '../../types';
import { toSAR } from '../../utils/currencyMath';
import { getPersonalRewardsAccounts } from '../../utils/wealthScope';

/** Ledger categories that must never inflate income/expense cashflow KPIs. */
export const REWARDS_STATEMENT_CREDIT_CATEGORY = 'Rewards Statement Credit';
export const REWARDS_CASH_DEPOSIT_CATEGORY = 'Rewards Cash Deposit';
export const REWARDS_LEDGER_CATEGORIES = [
  REWARDS_STATEMENT_CREDIT_CATEGORY,
  REWARDS_CASH_DEPOSIT_CATEGORY,
] as const;

export function isRewardsLedgerCategory(category?: string | null): boolean {
  const c = String(category ?? '').trim().toLowerCase();
  return REWARDS_LEDGER_CATEGORIES.some((x) => x.toLowerCase() === c);
}

/** Static provider templates — no live API. */
export const REWARDS_PROVIDER_TEMPLATES = [
  { key: 'qitaf', providerName: 'Qitaf', rewardType: 'points' as const, unitLabel: 'points', pointsPerFiatUnit: 100 },
  { key: 'alfursan', providerName: 'AlFursan', rewardType: 'miles' as const, unitLabel: 'miles', pointsPerFiatUnit: 100 },
  { key: 'mukafaat', providerName: 'Mukafaat', rewardType: 'points' as const, unitLabel: 'points', pointsPerFiatUnit: 100 },
  { key: 'card_cashback', providerName: 'Card Cashback', rewardType: 'cash' as const, unitLabel: 'SAR', pointsPerFiatUnit: 1 },
  { key: 'bank_points', providerName: 'Bank Points', rewardType: 'points' as const, unitLabel: 'points', pointsPerFiatUnit: 100 },
] as const;

export function fiatEquivalentFromPoints(
  amount: number,
  pointsPerFiatUnit: number,
): number {
  const rate = Number(pointsPerFiatUnit) > 0 ? Number(pointsPerFiatUnit) : 100;
  return Math.round(((Number(amount) || 0) / rate) * 100) / 100;
}

export function pointsFromFiat(fiat: number, pointsPerFiatUnit: number): number {
  const rate = Number(pointsPerFiatUnit) > 0 ? Number(pointsPerFiatUnit) : 100;
  return Math.round((Number(fiat) || 0) * rate * 100) / 100;
}

/** Convert account balance to SAR estimate at current rate (memo valuation). */
export function rewardsAccountFiatSar(account: RewardsAccount, sarPerUsd = 3.75): number {
  if (account.archived) return 0;
  const balance = Math.max(0, Number(account.currentBalance) || 0);
  if (!(balance > 0)) return 0;
  let fiatNative = balance;
  if (account.rewardType !== 'cash') {
    fiatNative = fiatEquivalentFromPoints(balance, account.pointsPerFiatUnit);
  }
  const currency = account.fiatCurrency === 'USD' ? 'USD' : 'SAR';
  return toSAR(fiatNative, currency, sarPerUsd);
}

/**
 * Optional Rewards bucket for headline NW / wealth summary.
 * Never include in emergency fund or investable cash.
 */
export function sumRewardsFiatSar(
  data: FinancialData | null | undefined,
  sarPerUsd = 3.75,
  opts?: { includeInNetWorth?: boolean },
): number {
  const include =
    opts?.includeInNetWorth ??
    data?.settings?.includeRewardsInNetWorth !== false;
  if (!include) return 0;
  return getPersonalRewardsAccounts(data).reduce(
    (sum, a) => sum + rewardsAccountFiatSar(a, sarPerUsd),
    0,
  );
}

/** Points/miles always excluded from Zakat until redeemed into cash/assets. */
export function sumRewardsZakatableSar(
  _data: FinancialData | null | undefined,
  _sarPerUsd = 3.75,
): number {
  return 0;
}

export function rewardsExpiringWithinDays(
  accounts: RewardsAccount[],
  transactions: RewardsTransaction[],
  withinDays = 30,
  todayYmd = new Date().toISOString().slice(0, 10),
  lots?: RewardsLot[],
): { accountId: string; providerName: string; expiresOn: string; amount: number }[] {
  const end = new Date(todayYmd + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + withinDays);
  const endYmd = end.toISOString().slice(0, 10);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows: { accountId: string; providerName: string; expiresOn: string; amount: number }[] = [];

  // Prefer open lots (remaining qty after FIFO redeems) when hydrated.
  const openLots = (lots ?? []).filter(
    (l) =>
      (Number(l.quantityRemaining) || 0) > 1e-9 &&
      l.expiresOn &&
      l.expiresOn >= todayYmd &&
      l.expiresOn <= endYmd,
  );
  if (openLots.length > 0) {
    for (const lot of openLots) {
      const acc = byId.get(lot.accountId);
      if (!acc || acc.archived) continue;
      rows.push({
        accountId: lot.accountId,
        providerName: acc.providerName,
        expiresOn: lot.expiresOn!,
        amount: Number(lot.quantityRemaining) || 0,
      });
    }
    return rows.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  }

  for (const tx of transactions) {
    if (tx.transactionType !== 'earn' || !tx.expiresOn) continue;
    if (tx.status === 'reversed') continue;
    if (tx.expiresOn < todayYmd || tx.expiresOn > endYmd) continue;
    const acc = byId.get(tx.accountId);
    if (!acc || acc.archived) continue;
    rows.push({
      accountId: tx.accountId,
      providerName: acc.providerName,
      expiresOn: tx.expiresOn,
      amount: Number(tx.amount) || 0,
    });
  }
  return rows.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

export function normalizeRewardsAccount(row: Record<string, unknown>): RewardsAccount {
  return {
    id: String(row.id ?? ''),
    providerName: String(row.provider_name ?? row.providerName ?? ''),
    rewardType: (String(row.reward_type ?? row.rewardType ?? 'points') as RewardsAccount['rewardType']),
    unitLabel: String(row.unit_label ?? row.unitLabel ?? 'points'),
    fiatCurrency: (String(row.fiat_currency ?? row.fiatCurrency ?? 'SAR') as 'SAR' | 'USD'),
    pointsPerFiatUnit: Number(row.points_per_fiat_unit ?? row.pointsPerFiatUnit ?? 100) || 100,
    currentBalance: Number(row.current_balance ?? row.currentBalance ?? 0) || 0,
    linkedAccountId: (row.linked_account_id ?? row.linkedAccountId ?? null) as string | null,
    linkedLiabilityId: (row.linked_liability_id ?? row.linkedLiabilityId ?? null) as string | null,
    owner: (row.owner as string | undefined) || undefined,
    expiryPolicyDays:
      row.expiry_policy_days != null || row.expiryPolicyDays != null
        ? Number(row.expiry_policy_days ?? row.expiryPolicyDays)
        : null,
    templateKey: (row.template_key ?? row.templateKey ?? null) as string | null,
    archived: Boolean(row.archived ?? false),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function normalizeRewardsTransaction(row: Record<string, unknown>): RewardsTransaction {
  return {
    id: String(row.id ?? ''),
    accountId: String(row.account_id ?? row.accountId ?? ''),
    transactionType: String(row.transaction_type ?? row.transactionType ?? 'earn') as RewardsTransaction['transactionType'],
    amount: Number(row.amount ?? 0) || 0,
    fiatEquivalent: Number(row.fiat_equivalent ?? row.fiatEquivalent ?? 0) || 0,
    rateSnapshot:
      row.rate_snapshot != null || row.rateSnapshot != null
        ? Number(row.rate_snapshot ?? row.rateSnapshot)
        : null,
    effectiveDate: String(row.effective_date ?? row.effectiveDate ?? '').slice(0, 10),
    expiresOn: row.expires_on || row.expiresOn ? String(row.expires_on ?? row.expiresOn).slice(0, 10) : null,
    note: (row.note as string | undefined) || undefined,
    reason: (row.reason as string | undefined) || undefined,
    idempotencyKey: String(row.idempotency_key ?? row.idempotencyKey ?? ''),
    redemptionGroupId: (row.redemption_group_id ?? row.redemptionGroupId ?? null) as string | null,
    status: String(row.status ?? 'posted') as RewardsTransaction['status'],
    reversesTxId: (row.reverses_tx_id ?? row.reversesTxId ?? null) as string | null,
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

export function rewardsAccountToRow(account: RewardsAccount, userId: string): Record<string, unknown> {
  return {
    id: account.id,
    user_id: userId,
    provider_name: account.providerName,
    reward_type: account.rewardType,
    unit_label: account.unitLabel,
    fiat_currency: account.fiatCurrency,
    points_per_fiat_unit: account.pointsPerFiatUnit,
    current_balance: account.currentBalance,
    linked_account_id: account.linkedAccountId ?? null,
    linked_liability_id: account.linkedLiabilityId ?? null,
    owner: account.owner ?? null,
    expiry_policy_days: account.expiryPolicyDays ?? null,
    template_key: account.templateKey ?? null,
    archived: Boolean(account.archived),
    updated_at: new Date().toISOString(),
  };
}

export function rewardsTransactionToRow(
  tx: Omit<RewardsTransaction, 'id'> & { id?: string },
  userId: string,
): Record<string, unknown> {
  return {
    ...(tx.id ? { id: tx.id } : {}),
    user_id: userId,
    account_id: tx.accountId,
    transaction_type: tx.transactionType,
    amount: tx.amount,
    fiat_equivalent: tx.fiatEquivalent,
    rate_snapshot: tx.rateSnapshot ?? null,
    effective_date: tx.effectiveDate,
    expires_on: tx.expiresOn ?? null,
    note: tx.note ?? null,
    reason: tx.reason ?? null,
    idempotency_key: tx.idempotencyKey,
    redemption_group_id: tx.redemptionGroupId ?? null,
    status: tx.status ?? 'posted',
    reverses_tx_id: tx.reversesTxId ?? null,
  };
}

export function normalizeRewardsLot(row: Record<string, unknown>): RewardsLot {
  return {
    id: String(row.id ?? ''),
    accountId: String(row.account_id ?? row.accountId ?? ''),
    earnTxId: String(row.earn_tx_id ?? row.earnTxId ?? ''),
    quantityRemaining: Number(row.quantity_remaining ?? row.quantityRemaining ?? 0) || 0,
    expiresOn: row.expires_on || row.expiresOn ? String(row.expires_on ?? row.expiresOn).slice(0, 10) : null,
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

export function rewardsLotToRow(lot: RewardsLot, userId: string): Record<string, unknown> {
  return {
    id: lot.id,
    user_id: userId,
    account_id: lot.accountId,
    earn_tx_id: lot.earnTxId,
    quantity_remaining: lot.quantityRemaining,
    expires_on: lot.expiresOn ?? null,
  };
}

/**
 * FIFO consume open lots for an account (soonest expiry first, then oldest created).
 * Returns the updated lot snapshots that must be persisted.
 */
export function planFifoLotConsumption(
  lots: RewardsLot[],
  accountId: string,
  quantity: number,
): { ok: true; updates: Array<{ id: string; quantityRemaining: number }> } | { ok: false; error: string } {
  const need = Math.abs(Number(quantity) || 0);
  if (!(need > 0)) return { ok: true, updates: [] };
  const open = lots
    .filter((l) => l.accountId === accountId && (Number(l.quantityRemaining) || 0) > 1e-9)
    .sort((a, b) => {
      const ae = a.expiresOn ?? '9999-12-31';
      const be = b.expiresOn ?? '9999-12-31';
      if (ae !== be) return ae.localeCompare(be);
      return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });
  const available = open.reduce((s, l) => s + (Number(l.quantityRemaining) || 0), 0);
  if (available + 1e-9 < need) {
    return { ok: false, error: 'Insufficient open reward lots for FIFO consumption.' };
  }
  let remaining = need;
  const updates: Array<{ id: string; quantityRemaining: number }> = [];
  for (const lot of open) {
    if (remaining <= 1e-9) break;
    const qty = Number(lot.quantityRemaining) || 0;
    const take = Math.min(qty, remaining);
    updates.push({ id: lot.id, quantityRemaining: Math.max(0, qty - take) });
    remaining -= take;
  }
  return { ok: true, updates };
}
