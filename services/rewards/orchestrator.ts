/**
 * Client-side rewards orchestrator: earn / redeem / expire / adjust / transfer / reverse.
 * Ledger-posting redeems create cash or investment legs + rewards_tx_links.
 * Cashback never posts as Income — uses Rewards Statement Credit / Rewards Cash Deposit categories.
 */

import type {
  Account,
  FinancialData,
  InvestmentTransaction,
  Liability,
  RewardsAccount,
  RewardsTransaction,
  RewardsTxLink,
  Transaction,
} from '../../types';
import { roundMoney } from '../../utils/money';
import { isMonthLocked } from '../netWorthSnapshot';
import {
  REWARDS_CASH_DEPOSIT_CATEGORY,
  REWARDS_STATEMENT_CREDIT_CATEGORY,
  fiatEquivalentFromPoints,
  normalizeRewardsAccount,
  normalizeRewardsLot,
  normalizeRewardsTransaction,
  planFifoLotConsumption,
  rewardsAccountToRow,
  rewardsLotToRow,
  rewardsTransactionToRow,
} from './rewardsDomain';

export type RewardsRedeemTarget =
  | { kind: 'non_ledger'; note?: string }
  | { kind: 'statement_credit'; accountId: string; liabilityId?: string | null }
  | { kind: 'cash_deposit'; accountId: string }
  | { kind: 'broker_deposit'; accountId: string; portfolioId?: string | null };

export interface RewardsOrchestratorDeps {
  db: {
    from: (table: string) => any;
  };
  userId: string;
  getData: () => FinancialData | null;
  applyFinancialDataPatch: (fn: (prev: FinancialData) => FinancialData) => void;
  addTransaction: (tx: Transaction) => Promise<void>;
  updateAccount: (acc: Account, opts?: { fromTransactionDelta?: boolean }) => Promise<void>;
  updateLiability?: (l: Liability) => Promise<void>;
  addInvestmentTransaction?: (tx: InvestmentTransaction) => Promise<void>;
  deleteTransaction?: (transactionId: string) => Promise<void>;
  deleteInvestmentTransaction?: (transactionId: string) => Promise<void>;
  toast?: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  canMutate: boolean;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function newId(): string {
  return crypto.randomUUID();
}

function signedDeltaForType(type: RewardsTransaction['transactionType'], amount: number): number {
  const a = Math.abs(Number(amount) || 0);
  switch (type) {
    case 'earn':
    case 'transfer_in':
      return a;
    case 'redeem':
    case 'expire':
    case 'transfer_out':
      return -a;
    case 'adjust':
      return Number(amount) || 0;
    default:
      return 0;
  }
}

async function insertLink(
  deps: RewardsOrchestratorDeps,
  link: Omit<RewardsTxLink, 'id'> & { id?: string },
): Promise<RewardsTxLink | null> {
  const id = link.id ?? newId();
  const row = {
    id,
    user_id: deps.userId,
    reward_tx_id: link.rewardTxId,
    financial_tx_id: link.financialTxId ?? null,
    investment_tx_id: link.investmentTxId ?? null,
    link_kind: link.linkKind,
  };
  const { error } = await deps.db.from('rewards_tx_links').insert(row);
  if (error) {
    console.warn('rewards_tx_links insert:', error);
    return null;
  }
  return {
    id,
    rewardTxId: link.rewardTxId,
    financialTxId: link.financialTxId ?? null,
    investmentTxId: link.investmentTxId ?? null,
    linkKind: link.linkKind,
  };
}

async function persistBalance(
  deps: RewardsOrchestratorDeps,
  account: RewardsAccount,
  nextBalance: number,
): Promise<{ ok: boolean; error?: string }> {
  const updated: RewardsAccount = { ...account, currentBalance: roundMoney(nextBalance) };
  const { error } = await deps.db
    .from('rewards_accounts')
    .update(rewardsAccountToRow(updated, deps.userId))
    .match({ id: account.id, user_id: deps.userId });
  if (error) return { ok: false, error: error.message };
  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    rewardsAccounts: (prev.rewardsAccounts ?? []).map((a) =>
      a.id === account.id ? updated : a,
    ),
  }));
  return { ok: true };
}

async function insertRewardTx(
  deps: RewardsOrchestratorDeps,
  tx: Omit<RewardsTransaction, 'id'> & { id?: string },
): Promise<{ ok: true; tx: RewardsTransaction } | { ok: false; error: string; existing?: RewardsTransaction }> {
  const id = tx.id ?? newId();
  const row = rewardsTransactionToRow({ ...tx, id }, deps.userId);
  const { data, error } = await deps.db.from('rewards_transactions').insert(row).select('*').maybeSingle();
  if (error) {
    if (String(error.message ?? '').toLowerCase().includes('duplicate') || error.code === '23505') {
      const { data: existing } = await deps.db
        .from('rewards_transactions')
        .select('*')
        .eq('user_id', deps.userId)
        .eq('idempotency_key', tx.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return { ok: false, error: 'Already applied (idempotent).', existing: normalizeRewardsTransaction(existing) };
      }
    }
    return { ok: false, error: error.message ?? 'Insert failed' };
  }
  const normalized = normalizeRewardsTransaction(data ?? row);
  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    rewardsTransactions: [normalized, ...(prev.rewardsTransactions ?? [])],
  }));
  return { ok: true, tx: normalized };
}

export async function createRewardsAccount(
  deps: RewardsOrchestratorDeps,
  input: Omit<RewardsAccount, 'id' | 'currentBalance'> & { currentBalance?: number; id?: string },
): Promise<{ ok: boolean; account?: RewardsAccount; error?: string }> {
  if (!deps.canMutate) return { ok: false, error: 'Restricted role cannot mutate rewards.' };
  const account: RewardsAccount = {
    id: input.id ?? newId(),
    providerName: input.providerName,
    rewardType: input.rewardType,
    unitLabel: input.unitLabel,
    fiatCurrency: input.fiatCurrency,
    pointsPerFiatUnit: input.pointsPerFiatUnit,
    currentBalance: Number(input.currentBalance) || 0,
    linkedAccountId: input.linkedAccountId ?? null,
    linkedLiabilityId: input.linkedLiabilityId ?? null,
    owner: input.owner,
    expiryPolicyDays: input.expiryPolicyDays ?? null,
    templateKey: input.templateKey ?? null,
    archived: false,
  };
  const { error } = await deps.db.from('rewards_accounts').insert(rewardsAccountToRow(account, deps.userId));
  if (error) return { ok: false, error: error.message };
  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    rewardsAccounts: [...(prev.rewardsAccounts ?? []), account],
  }));
  return { ok: true, account };
}

export async function postRewardsLedgerEvent(
  deps: RewardsOrchestratorDeps,
  args: {
    accountId: string;
    transactionType: RewardsTransaction['transactionType'];
    amount: number;
    effectiveDate?: string;
    expiresOn?: string | null;
    note?: string;
    reason?: string;
    idempotencyKey: string;
    redemptionGroupId?: string | null;
    /** For adjust: signed amount already; for others: absolute quantity. */
    signedAdjust?: boolean;
    /** Set when this event undoes an earlier rewards transaction (audit lineage). */
    reversesTxId?: string | null;
  },
): Promise<{ ok: boolean; tx?: RewardsTransaction; error?: string }> {
  if (!deps.canMutate) return { ok: false, error: 'Restricted role cannot mutate rewards.' };
  const data = deps.getData();
  const account = (data?.rewardsAccounts ?? []).find((a) => a.id === args.accountId);
  if (!account) return { ok: false, error: 'Rewards account not found.' };
  if (account.archived) return { ok: false, error: 'Account is archived.' };

  const delta = args.signedAdjust
    ? Number(args.amount) || 0
    : signedDeltaForType(args.transactionType, args.amount);
  const next = roundMoney((Number(account.currentBalance) || 0) + delta);
  if (next < -1e-9 && args.transactionType !== 'adjust') {
    return { ok: false, error: 'Insufficient rewards balance.' };
  }

  const absAmount = Math.abs(Number(args.amount) || 0);
  const fiat =
    account.rewardType === 'cash'
      ? absAmount
      : fiatEquivalentFromPoints(absAmount, account.pointsPerFiatUnit);

  const consumesLots =
    args.transactionType === 'redeem' ||
    args.transactionType === 'expire' ||
    args.transactionType === 'transfer_out';
  let fifoPlan: ReturnType<typeof planFifoLotConsumption> | null = null;
  if (consumesLots && absAmount > 0) {
    const openLots = (data?.rewardsLots ?? []).filter(
      (l) => l.accountId === account.id && (Number(l.quantityRemaining) || 0) > 1e-9,
    );
    if (openLots.length > 0) {
      fifoPlan = planFifoLotConsumption(data?.rewardsLots ?? [], account.id, absAmount);
      if (!fifoPlan.ok) {
        return { ok: false, error: fifoPlan.error ?? 'FIFO lot consumption failed.' };
      }
    }
    // Legacy: no open lots → balance-only (pre-lot data).
  }

  const inserted = await insertRewardTx(deps, {
    accountId: account.id,
    transactionType: args.transactionType,
    amount: args.signedAdjust ? Number(args.amount) || 0 : absAmount,
    fiatEquivalent: roundMoney(fiat),
    rateSnapshot: account.pointsPerFiatUnit,
    effectiveDate: (args.effectiveDate ?? todayYmd()).slice(0, 10),
    expiresOn: args.expiresOn ?? null,
    note: args.note,
    reason: args.reason,
    idempotencyKey: args.idempotencyKey,
    redemptionGroupId: args.redemptionGroupId ?? null,
    reversesTxId: args.reversesTxId ?? null,
    status: 'posted',
  });
  if (!inserted.ok) {
    if (inserted.existing) return { ok: true, tx: inserted.existing };
    return { ok: false, error: inserted.error };
  }
  const bal = await persistBalance(deps, account, Math.max(0, next));
  if (!bal.ok) return { ok: false, error: bal.error };

  // Earn / transfer_in open a FIFO lot; redeem/expire/transfer_out apply the planned consumption.
  if ((args.transactionType === 'earn' || args.transactionType === 'transfer_in') && inserted.tx) {
    const lotId = newId();
    const lotRow = rewardsLotToRow(
      {
        id: lotId,
        accountId: account.id,
        earnTxId: inserted.tx.id,
        quantityRemaining: absAmount,
        expiresOn: args.expiresOn ?? null,
      },
      deps.userId,
    );
    const { error: lotErr } = await deps.db.from('rewards_lots').insert(lotRow);
    if (!lotErr) {
      deps.applyFinancialDataPatch((prev) => ({
        ...prev,
        rewardsLots: [
          normalizeRewardsLot(lotRow),
          ...(prev.rewardsLots ?? []),
        ],
      }));
    }
  } else if (fifoPlan && fifoPlan.ok) {
    const results = await Promise.all(
      fifoPlan.updates.map((u) =>
        deps.db
          .from('rewards_lots')
          .update({ quantity_remaining: u.quantityRemaining })
          .match({ id: u.id, user_id: deps.userId }),
      ),
    );
    const firstErr = results.find((r) => r?.error)?.error;
    if (firstErr) {
      // Balance already moved — restore so UI balance stays consistent with lots.
      await persistBalance(deps, account, Number(account.currentBalance) || 0);
      await deps.db
        .from('rewards_transactions')
        .update({ status: 'incomplete' })
        .match({ id: inserted.tx!.id, user_id: deps.userId });
      deps.applyFinancialDataPatch((prev) => ({
        ...prev,
        rewardsTransactions: (prev.rewardsTransactions ?? []).map((t) =>
          t.id === inserted.tx!.id ? { ...t, status: 'incomplete' as const } : t,
        ),
      }));
      return {
        ok: false,
        error: firstErr.message ?? 'Failed to update rewards lots after redeem.',
      };
    }
    const updateMap = new Map(fifoPlan.updates.map((u) => [u.id, u.quantityRemaining]));
    deps.applyFinancialDataPatch((prev) => ({
      ...prev,
      rewardsLots: (prev.rewardsLots ?? []).map((l) =>
        updateMap.has(l.id) ? { ...l, quantityRemaining: updateMap.get(l.id)! } : l,
      ),
    }));
  } else if (args.transactionType === 'adjust' && (Number(args.amount) || 0) > 0 && args.reversesTxId) {
    // Reversal credit: open a fresh lot so restored points remain redeemable.
    const lotId = newId();
    const qty = Math.abs(Number(args.amount) || 0);
    const lotRow = rewardsLotToRow(
      {
        id: lotId,
        accountId: account.id,
        earnTxId: inserted.tx!.id,
        quantityRemaining: qty,
        expiresOn: null,
      },
      deps.userId,
    );
    const { error: lotErr } = await deps.db.from('rewards_lots').insert(lotRow);
    if (!lotErr) {
      deps.applyFinancialDataPatch((prev) => ({
        ...prev,
        rewardsLots: [normalizeRewardsLot(lotRow), ...(prev.rewardsLots ?? [])],
      }));
    }
  }

  return { ok: true, tx: inserted.tx };
}

export async function redeemRewards(
  deps: RewardsOrchestratorDeps,
  args: {
    accountId: string;
    amount: number;
    target: RewardsRedeemTarget;
    idempotencyKey: string;
    effectiveDate?: string;
    reason?: string;
  },
): Promise<{ ok: boolean; tx?: RewardsTransaction; error?: string }> {
  if (!deps.canMutate) return { ok: false, error: 'Restricted role cannot mutate rewards.' };
  const amount = Math.abs(Number(args.amount) || 0);
  if (!(amount > 0)) return { ok: false, error: 'Amount must be positive.' };

  const data = deps.getData();
  const account = (data?.rewardsAccounts ?? []).find((a) => a.id === args.accountId);
  if (!account) return { ok: false, error: 'Rewards account not found.' };
  if ((Number(account.currentBalance) || 0) + 1e-9 < amount) {
    return { ok: false, error: 'Insufficient rewards balance.' };
  }

  const effectiveDate = (args.effectiveDate ?? todayYmd()).slice(0, 10);
  const target = args.target;
  if (target.kind !== 'non_ledger' && isMonthLocked(effectiveDate.slice(0, 7))) {
    return { ok: false, error: 'Month is locked. Unlock period close before posting ledger redemptions.' };
  }

  const redemptionGroupId = args.idempotencyKey;
  const fiat =
    account.rewardType === 'cash'
      ? amount
      : fiatEquivalentFromPoints(amount, account.pointsPerFiatUnit);
  const fiatRounded = roundMoney(fiat);

  const posted = await postRewardsLedgerEvent(deps, {
    accountId: account.id,
    transactionType: 'redeem',
    amount,
    effectiveDate,
    reason: args.reason,
    idempotencyKey: args.idempotencyKey,
    redemptionGroupId,
  });
  if (!posted.ok || !posted.tx) return posted;

  try {
    if (target.kind === 'non_ledger') {
      return { ok: true, tx: posted.tx };
    }

    if (target.kind === 'statement_credit') {
      const acc = (data?.accounts ?? []).find((a) => a.id === target.accountId);
      if (!acc) throw new Error('Target credit/cash account not found.');
      const liabilityId =
        target.liabilityId ??
        account.linkedLiabilityId ??
        (data?.liabilities ?? []).find((l) => l.accountId === acc.id)?.id ??
        null;
      const cashTx: Transaction = {
        id: newId(),
        date: effectiveDate,
        description: `Rewards statement credit — ${account.providerName}`,
        amount: fiatRounded,
        category: REWARDS_STATEMENT_CREDIT_CATEGORY,
        accountId: acc.id,
        type: 'income',
        note: `redemption_group:${redemptionGroupId}`,
      };
      await deps.addTransaction(cashTx);
      await insertLink(deps, {
        rewardTxId: posted.tx.id,
        financialTxId: cashTx.id,
        linkKind: 'statement_credit',
      });
      if (liabilityId && deps.updateLiability) {
        const liab = (deps.getData()?.liabilities ?? []).find((l) => l.id === liabilityId);
        if (liab) {
          await deps.updateLiability({
            ...liab,
            amount: roundMoney(Math.max(0, (Number(liab.amount) || 0) - fiatRounded)),
          });
        }
      }
      return { ok: true, tx: posted.tx };
    }

    if (target.kind === 'cash_deposit') {
      const acc = (data?.accounts ?? []).find((a) => a.id === target.accountId);
      if (!acc) throw new Error('Target cash account not found.');
      const cashTx: Transaction = {
        id: newId(),
        date: effectiveDate,
        description: `Rewards cash deposit — ${account.providerName}`,
        amount: fiatRounded,
        category: REWARDS_CASH_DEPOSIT_CATEGORY,
        accountId: acc.id,
        type: 'income',
        note: `redemption_group:${redemptionGroupId}`,
      };
      await deps.addTransaction(cashTx);
      await insertLink(deps, {
        rewardTxId: posted.tx.id,
        financialTxId: cashTx.id,
        linkKind: 'cash_deposit',
      });
      return { ok: true, tx: posted.tx };
    }

    if (target.kind === 'broker_deposit') {
      if (!deps.addInvestmentTransaction) throw new Error('Investment deposit unavailable.');
      const invTx: InvestmentTransaction = {
        id: newId(),
        date: effectiveDate,
        type: 'deposit',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: fiatRounded,
        fees: 0,
        accountId: target.accountId,
        portfolioId: target.portfolioId ?? undefined,
        idempotencyKey: `rewards_redeem:${redemptionGroupId}:broker`,
      };
      await deps.addInvestmentTransaction(invTx);
      await insertLink(deps, {
        rewardTxId: posted.tx.id,
        investmentTxId: invTx.id,
        linkKind: 'broker_deposit',
      });
      return { ok: true, tx: posted.tx };
    }

    return { ok: true, tx: posted.tx };
  } catch (e) {
    // Compensating reverse of the redeem so points (and FIFO lots) are not stranded.
    // `reversesTxId` opens a replacement lot for the restored quantity.
    await postRewardsLedgerEvent(deps, {
      accountId: account.id,
      transactionType: 'adjust',
      amount,
      signedAdjust: true,
      effectiveDate,
      reason: 'Compensating reverse — ledger leg failed',
      idempotencyKey: `${args.idempotencyKey}|compensate`,
      redemptionGroupId,
      reversesTxId: posted.tx.id,
    });
    await deps.db
      .from('rewards_transactions')
      .update({ status: 'incomplete' })
      .match({ id: posted.tx.id, user_id: deps.userId });
    deps.applyFinancialDataPatch((prev) => ({
      ...prev,
      rewardsTransactions: (prev.rewardsTransactions ?? []).map((t) =>
        t.id === posted.tx!.id ? { ...t, status: 'incomplete' } : t,
      ),
    }));
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Ledger leg failed; redeem compensated.',
    };
  }
}

/**
 * Undo a posted (or incomplete) redemption: removes the ledger leg(s) first, restores the
 * liability when the redeem paid down a card, then credits the points back and marks the
 * original `reversed`. Ledger legs are undone before points so a failure never mints points.
 */
export async function reverseRewardsRedemption(
  deps: RewardsOrchestratorDeps,
  args: { rewardTxId: string; reason?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!deps.canMutate) return { ok: false, error: 'Restricted role cannot mutate rewards.' };

  const data = deps.getData();
  const original = (data?.rewardsTransactions ?? []).find((t) => t.id === args.rewardTxId);
  if (!original) return { ok: false, error: 'Rewards transaction not found.' };
  if (original.transactionType !== 'redeem') {
    return { ok: false, error: 'Only redemptions can be reversed here.' };
  }
  if (original.status === 'reversed') return { ok: false, error: 'Already reversed.' };

  const account = (data?.rewardsAccounts ?? []).find((a) => a.id === original.accountId);
  if (!account) return { ok: false, error: 'Rewards account not found.' };

  const links = (data?.rewardsTxLinks ?? []).filter((l) => l.rewardTxId === original.id);
  if (links.length > 0 && isMonthLocked(original.effectiveDate.slice(0, 7))) {
    return { ok: false, error: 'Month is locked. Unlock period close before reversing ledger legs.' };
  }

  const fiat = roundMoney(Number(original.fiatEquivalent) || 0);

  try {
    for (const link of links) {
      if (link.financialTxId) {
        if (!deps.deleteTransaction) throw new Error('Cash ledger reversal unavailable.');
        await deps.deleteTransaction(link.financialTxId);
        // `deleteTransaction` logs DB failures instead of throwing — confirm before crediting points.
        const stillThere = (deps.getData()?.transactions ?? []).some((t) => t.id === link.financialTxId);
        if (stillThere) throw new Error('Cash leg could not be removed; nothing was changed.');
      }
      if (link.investmentTxId) {
        if (!deps.deleteInvestmentTransaction) throw new Error('Investment ledger reversal unavailable.');
        await deps.deleteInvestmentTransaction(link.investmentTxId);
        const stillThere = (deps.getData()?.investmentTransactions ?? []).some(
          (t) => t.id === link.investmentTxId,
        );
        if (stillThere) throw new Error('Investment leg could not be removed; nothing was changed.');
      }
      if (link.linkKind === 'statement_credit' && deps.updateLiability) {
        const liabilityId =
          account.linkedLiabilityId ??
          (deps.getData()?.liabilities ?? []).find((l) => l.accountId === account.linkedAccountId)?.id ??
          null;
        const liab = liabilityId
          ? (deps.getData()?.liabilities ?? []).find((l) => l.id === liabilityId)
          : undefined;
        if (liab) {
          await deps.updateLiability({
            ...liab,
            amount: roundMoney((Number(liab.amount) || 0) + fiat),
          });
        }
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not reverse the ledger leg; points left untouched.',
    };
  }

  const credited = await postRewardsLedgerEvent(deps, {
    accountId: account.id,
    transactionType: 'adjust',
    amount: Math.abs(Number(original.amount) || 0),
    signedAdjust: true,
    effectiveDate: todayYmd(),
    reason: args.reason ?? 'Reversal of redemption',
    idempotencyKey: `rewards_reverse:${original.id}`,
    redemptionGroupId: original.redemptionGroupId ?? null,
    reversesTxId: original.id,
  });
  if (!credited.ok) return { ok: false, error: credited.error };

  const { error } = await deps.db
    .from('rewards_transactions')
    .update({ status: 'reversed' })
    .match({ id: original.id, user_id: deps.userId });
  if (error) return { ok: false, error: error.message };

  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    rewardsTransactions: (prev.rewardsTransactions ?? []).map((t) =>
      t.id === original.id ? { ...t, status: 'reversed' as const } : t,
    ),
  }));
  return { ok: true };
}

export async function transferRewards(
  deps: RewardsOrchestratorDeps,
  args: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    idempotencyKey: string;
    reason?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const amount = Math.abs(Number(args.amount) || 0);
  const out = await postRewardsLedgerEvent(deps, {
    accountId: args.fromAccountId,
    transactionType: 'transfer_out',
    amount,
    reason: args.reason,
    idempotencyKey: `${args.idempotencyKey}|out`,
    redemptionGroupId: args.idempotencyKey,
  });
  if (!out.ok) return out;
  const inn = await postRewardsLedgerEvent(deps, {
    accountId: args.toAccountId,
    transactionType: 'transfer_in',
    amount,
    reason: args.reason,
    idempotencyKey: `${args.idempotencyKey}|in`,
    redemptionGroupId: args.idempotencyKey,
  });
  return inn;
}

export function normalizeRewardsAccountsFromRows(rows: unknown[]): RewardsAccount[] {
  return (rows ?? []).map((r) => normalizeRewardsAccount(r as Record<string, unknown>));
}

export function normalizeRewardsTransactionsFromRows(rows: unknown[]): RewardsTransaction[] {
  return (rows ?? []).map((r) => normalizeRewardsTransaction(r as Record<string, unknown>));
}
