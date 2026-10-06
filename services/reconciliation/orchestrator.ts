/**
 * DataContext-facing orchestration for preview/apply/reverse reconciliation.
 * Domain ledgers are mutated via injected callbacks so this module stays testable.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Account,
  Asset,
  CommodityHolding,
  FinancialData,
  Holding,
  InvestmentPortfolio,
  Liability,
  SukukPosition,
  Transaction,
} from '../../types';
import { isPersonalWealth } from '../../utils/wealthScope';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../../utils/money';
import { findCreditCardLiabilityForAccount } from '../creditCardLinking';
import {
  appCalendarTodayYmd,
  assertCanReverseAdjustment,
  buildBrokerCashReconcileInvestmentRow,
  buildCashReconcileLedgerTransaction,
  buildIdempotencyKey,
  buildReverseBrokerCashRow,
  buildReverseCashLedgerTx,
  insertReconciliationAdjustment,
  insertReconciliationAudit,
  insertReconciliationRun,
  isCashReconcileEligibleAccount,
  isValidReason,
  markAdjustmentReversed,
  mechanismForEntity,
  normalizeReason,
  pendingApprovalsBlockAccount,
  previewFromInput,
  resolveHoldingReconcileBook,
  replayAffectedPortfolioSymbols,
  reverseTargets,
  type ApplyReconciliationInput,
  type ApplyReconciliationResult,
  type ReconciliationAdjustment,
} from './index';
import { buildReplayRunPayload } from './replay';
import { normalizeReconciliationAdjustmentRow } from './types';
import {
  alignOpenLotsToTargetQuantity,
  rescaleOpenLotsToTargetBookCost,
} from '../alignOpenLotsToHolding';

export interface ReconciliationOrchestratorDeps {
  db: SupabaseClient;
  userId: string;
  getData: () => FinancialData;
  addTransaction: (tx: Omit<Transaction, 'id' | 'user_id'>, opts?: { confirmed?: boolean; system?: boolean }) => Promise<void>;
  /** Investment deposit/withdrawal-style row + cash delta. */
  recordBrokerCashAdjust: (row: {
    type: 'deposit' | 'withdrawal';
    total: number;
    date: string;
    accountId: string;
    portfolioId?: string;
    currency: 'SAR' | 'USD';
    note: string;
    idempotencyKey?: string;
  }) => Promise<{ id: string | null }>;
  updatePlatform: (account: Account, opts?: { fromTransactionDelta?: boolean }) => Promise<void>;
  updateAsset: (asset: Asset) => Promise<void>;
  updateCommodityHolding: (holding: CommodityHolding) => Promise<void>;
  updateLiability: (liability: Liability) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  updateSukukPosition?: (position: SukukPosition, opts?: { viaReconciliation?: boolean }) => Promise<void>;
  /** Rebuild only unposted future payout events after a principal restatement. */
  regenerateSukukFutureSchedule?: (positionId: string) => Promise<void>;
  /**
   * After quantity reconcile: rebuild FIFO lots + realized PnL for the symbol without
   * overwriting the just-set book quantity (same contract as syncLotsAfterTrade).
   */
  syncLotsForSymbols?: (args: { portfolioId: string; symbols: string[] }) => Promise<void>;
  /** Persist open lots after cost rescale (qty already trimmed by syncLotsForSymbols). */
  persistAlignedLotsForPortfolio?: (args: {
    portfolioId: string;
    lots: import('../../types').InvestmentCostLot[];
  }) => Promise<void>;
  /** Reverse a prior buy/sell/dividend/fee/deposit edit that wrote an adjustment row. */
  reverseInvestmentTransactionEdit?: (adj: ReconciliationAdjustment) => Promise<void>;
  applyFinancialDataPatch: (fn: (prev: FinancialData) => FinancialData) => void;
  bumpHoldingsBookGeneration?: () => void;
  /** Advance the holdings book generation AND rewrite the hydrate cache so stale cache cannot resurrect pre-adjust numbers. */
  sealBookAfterAdjust?: () => void;
  /** Append a net-worth snapshot revision for the effective day (append-only history). */
  captureSnapshotRevision?: (args: {
    snapshotDay: string;
    adjustmentId?: string | null;
    runId?: string | null;
    reason: string;
    mechanism: string;
  }) => Promise<void>;
  /** Role of the signed-in user; Restricted members may not post adjustments. */
  userRole?: string | null;
  toast?: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}

/** Adjustments are owner-only writes on personal wealth entities (managed `owner` books are excluded). */
function assertOwnedEntity(
  data: FinancialData,
  entityType: ApplyReconciliationInput['entityType'],
  entityId: string,
): string | null {
  const managedMsg =
    'Managed wealth (Owner set, e.g. Father/Spouse) cannot be adjusted from personal reconcile — clear Owner first or edit in the managed book only.';
  const missingMsg = 'Only the owner of this record can reconcile it (record not found in your workspace).';
  switch (entityType) {
    case 'account': {
      const a = (data.accounts ?? []).find((x) => x.id === entityId);
      if (!a) return missingMsg;
      if (!isPersonalWealth(a)) return managedMsg;
      return null;
    }
    case 'asset': {
      const a = (data.assets ?? []).find((x) => x.id === entityId);
      if (!a) return missingMsg;
      if (!isPersonalWealth(a)) return managedMsg;
      return null;
    }
    case 'commodity': {
      const c = (data.commodityHoldings ?? []).find((x) => x.id === entityId);
      if (!c) return missingMsg;
      if (!isPersonalWealth(c)) return managedMsg;
      return null;
    }
    case 'liability': {
      const l = (data.liabilities ?? []).find((x) => x.id === entityId);
      if (!l) return missingMsg;
      if (!isPersonalWealth(l)) return managedMsg;
      return null;
    }
    case 'sukuk_position': {
      const p = (data.sukukPositions ?? []).find((x) => x.id === entityId);
      if (!p) return missingMsg;
      // Sukuk positions inherit personal scope via mapped investment account when owner absent on row.
      const acc = (data.accounts ?? []).find((a) => a.id === p.investmentAccountId);
      if (acc && !isPersonalWealth(acc)) return managedMsg;
      return null;
    }
    case 'holding': {
      for (const p of data.investments ?? []) {
        const h = (p.holdings ?? []).find((x) => x.id === entityId);
        if (h) {
          if (!isPersonalWealth(p)) return managedMsg;
          return null;
        }
      }
      return missingMsg;
    }
    default:
      return null;
  }
}

function roleBlocksAdjustments(userRole?: string | null): string | null {
  const role = String(userRole ?? '').trim().toLowerCase();
  if (role === 'restricted' || role === 'viewer') {
    return 'Your role cannot post reconciliation adjustments. Ask the workspace owner.';
  }
  return null;
}

function lastInsertedCashTx(data: FinancialData, accountId: string): Transaction | undefined {
  return (data.transactions ?? []).find((t) => String(t.accountId) === String(accountId));
}

export async function orchestratePreviewReconciliation(
  data: FinancialData,
  input: ApplyReconciliationInput,
) {
  return previewFromInput(data, input);
}

export async function orchestrateApplyReconciliation(
  deps: ReconciliationOrchestratorDeps,
  input: ApplyReconciliationInput,
): Promise<ApplyReconciliationResult> {
  if (!isValidReason(input.reason)) {
    return { ok: false, error: 'Reason is required (at least 3 characters).' };
  }
  const roleBlock = roleBlocksAdjustments(deps.userRole);
  if (roleBlock) return { ok: false, error: roleBlock };
  const data = deps.getData();
  const ownerBlock = assertOwnedEntity(data, input.entityType, input.entityId);
  if (ownerBlock) return { ok: false, error: ownerBlock };
  /**
   * Cash accounts legitimately choose between reconcile_balance and opening_balance; every other entity
   * has exactly one mechanism, so normalize it rather than trusting the caller.
   */
  const mechanism =
    input.entityType === 'account' ? input.mechanism : mechanismForEntity(input.entityType, input.mechanism);
  input = { ...input, mechanism };
  const preview = previewFromInput(data, { ...input, reason: input.reason });
  if ('error' in preview) return { ok: false, error: preview.error };
  if (preview.blockedReason) return { ok: false, error: preview.blockedReason };
  if (preview.noop) {
    return { ok: true, noop: true };
  }

  const reason = normalizeReason(input.reason);
  const effectiveDate = (input.effectiveDate || appCalendarTodayYmd()).slice(0, 10);
  const clientNonce = input.clientNonce || `${Date.now()}`;

  if (input.entityType === 'account') {
    return applyCashAccount(deps, input, preview as any, reason, effectiveDate, clientNonce);
  }
  if (input.entityType === 'asset' || input.entityType === 'commodity' || input.entityType === 'liability') {
    return applyRevaluation(deps, input, preview as any, reason, effectiveDate, clientNonce);
  }
  if (input.entityType === 'sukuk_position') {
    return applySukukPrincipal(deps, input, preview as any, reason, effectiveDate, clientNonce);
  }
  if (input.entityType === 'holding') {
    return applyHoldingQty(deps, input, preview as any, reason, effectiveDate, clientNonce);
  }
  return { ok: false, error: `Unsupported entity type: ${input.entityType}` };
}

async function applyCashAccount(
  deps: ReconciliationOrchestratorDeps,
  input: ApplyReconciliationInput,
  preview: {
    beforeValue: number;
    actualValue: number;
    delta: number;
    currency: 'SAR' | 'USD';
    mechanism: string;
    accountType?: string;
  },
  reason: string,
  effectiveDate: string,
  clientNonce: string,
): Promise<ApplyReconciliationResult> {
  const data = deps.getData();
  const account = (data.accounts ?? []).find((a) => a.id === input.entityId);
  if (!account || !isCashReconcileEligibleAccount(account)) {
    return { ok: false, error: 'Account not found or not eligible for Reconcile Balance.' };
  }
  if (pendingApprovalsBlockAccount(account.id, data.transactions)) {
    return { ok: false, error: 'Apply blocked: pending/approval transactions exist on this account.' };
  }

  // Prefer SECURITY DEFINER RPC for Checking/Savings/Credit when available.
  if (account.type !== 'Investment') {
    const { data: rpcData, error: rpcErr } = await deps.db.rpc('apply_reconciliation_adjustment', {
      p_entity_type: 'account',
      p_entity_id: account.id,
      p_actual_value: preview.actualValue,
      p_reason: reason,
      p_mechanism: preview.mechanism,
      p_effective_date: effectiveDate,
      p_idempotency_key: null,
      p_client_nonce: clientNonce,
    });
    if (!rpcErr && rpcData && (rpcData as any).ok) {
      // Refresh local state via soft refetch of affected rows
      const { data: accRow } = await deps.db.from('accounts').select('*').eq('id', account.id).maybeSingle();
      /** Production may expose camelCase `accountId` only — try snake then camel. */
      let txs: unknown[] | null = null;
      {
        const snake = await deps.db
          .from('transactions')
          .select('*')
          .eq('user_id', deps.userId)
          .eq('account_id', account.id)
          .order('date', { ascending: false })
          .limit(50);
        if (!snake.error && Array.isArray(snake.data)) {
          txs = snake.data;
        } else {
          const camel = await deps.db
            .from('transactions')
            .select('*')
            .eq('user_id', deps.userId)
            .eq('accountId', account.id)
            .order('date', { ascending: false })
            .limit(50);
          if (!camel.error && Array.isArray(camel.data)) txs = camel.data;
        }
      }
      let liabilityPatch: Liability | null = null;
      if (account.type === 'Credit') {
        const liab = findCreditCardLiabilityForAccount(data.liabilities, account.id);
        if (liab) {
          const { data: liabRow } = await deps.db.from('liabilities').select('*').eq('id', liab.id).maybeSingle();
          if (liabRow) liabilityPatch = { ...liab, amount: Number((liabRow as any).amount) };
        }
      }
      deps.applyFinancialDataPatch((prev) => {
        const incoming = Array.isArray(txs)
          ? ((txs as any[]) || []).map((t) => ({
              ...t,
              accountId: t.account_id ?? t.accountId,
            }))
          : [];
        const incomingIds = new Set(incoming.map((t) => String(t.id)));
        return {
          ...prev,
          accounts: accRow
            ? prev.accounts.map((a) =>
                a.id === account.id ? { ...a, balance: Number((accRow as any).balance) } : a,
              )
            : prev.accounts,
          transactions: Array.isArray(txs)
            ? [...incoming, ...prev.transactions.filter((t) => !incomingIds.has(String(t.id)))]
            : prev.transactions,
          liabilities: liabilityPatch
            ? prev.liabilities.map((l) => (l.id === liabilityPatch!.id ? liabilityPatch! : l))
            : prev.liabilities,
        };
      });
      const adjId = String((rpcData as any).adjustmentId ?? '');
      await afterApplyRefresh(deps, {
        effectiveDate,
        adjustmentId: adjId || null,
        reason,
        mechanism: preview.mechanism,
      });
      return {
        ok: true,
        noop: Boolean((rpcData as any).noop),
        adjustment: adjId
          ? ({
              id: adjId,
              mechanism: preview.mechanism as any,
              entityType: 'account',
              entityId: account.id,
              effectiveDate,
              currency: preview.currency,
              beforeValue: preview.beforeValue,
              actualValue: preview.actualValue,
              delta: preview.delta,
              reason,
              idempotencyKey: '',
              status: (rpcData as any).noop ? 'noop' : 'applied',
            } as ReconciliationAdjustment)
          : undefined,
      };
    }
    // Fall through to client path when RPC missing OR transactions column-compat error
    // (production schemas that only have "accountId" before fix migration is applied).
    const rpcMsg = String(rpcErr?.message ?? '');
    if (
      rpcErr &&
      !/could not find|PGRST|function|schema cache|404|account_id does not exist|accountId does not exist/i.test(
        rpcMsg,
      )
    ) {
      return { ok: false, error: rpcErr.message };
    }
  }

  const idempotencyKey = buildIdempotencyKey({
    userId: deps.userId,
    entityType: 'account',
    entityId: account.id,
    effectiveDate,
    mechanism: preview.mechanism,
    delta: preview.delta,
    reason,
    clientNonce,
  });

  let generatedTransactionId: string | null = null;
  let generatedInvestmentTransactionId: string | null = null;

  if (account.type === 'Investment') {
    const portfolio = (data.investments ?? []).find(
      (p) => String(p.accountId ?? (p as any).account_id) === String(account.id),
    );
    const row = buildBrokerCashReconcileInvestmentRow({
      accountId: account.id,
      portfolioId: portfolio?.id,
      delta: preview.delta,
      currency: preview.currency,
      effectiveDate,
      reason,
      idempotencyKey,
    });
    const inserted = await deps.recordBrokerCashAdjust(row);
    generatedInvestmentTransactionId = inserted.id;
  } else {
    const tx = buildCashReconcileLedgerTransaction({
      account,
      delta: preview.delta,
      mechanism: preview.mechanism as 'reconcile_balance' | 'opening_balance',
      effectiveDate,
      reason,
    });
    await deps.addTransaction(tx, { system: true });
    const fresh = deps.getData();
    generatedTransactionId = lastInsertedCashTx(fresh, account.id)?.id ?? null;
  }

  const { data: adj, error: adjErr, duplicate } = await insertReconciliationAdjustment(deps.db, deps.userId, {
    mechanism: preview.mechanism as any,
    entityType: 'account',
    entityId: account.id,
    accountId: account.id,
    effectiveDate,
    currency: preview.currency,
    beforeValue: preview.beforeValue,
    actualValue: preview.actualValue,
    delta: preview.delta,
    reason,
    idempotencyKey,
    generatedTransactionId,
    generatedInvestmentTransactionId,
  });
  if (adjErr) return { ok: false, error: adjErr.message };
  if (duplicate && adj) return { ok: true, adjustment: adj };

  const audit = await insertReconciliationAudit(deps.db, deps.userId, {
    kind: 'adjustment',
    mechanism: preview.mechanism,
    entityType: 'account',
    entityId: account.id,
    effectiveDate,
    beforeValue: preview.beforeValue,
    afterValue: preview.actualValue,
    delta: preview.delta,
    currency: preview.currency,
    reason,
    adjustmentId: adj?.id ?? null,
    summary: `Reconcile Balance ${preview.beforeValue} → ${preview.actualValue} (Δ ${preview.delta} ${preview.currency})`,
  });

  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    reconciliationAdjustments: adj
      ? [adj as any, ...(prev.reconciliationAdjustments ?? [])]
      : prev.reconciliationAdjustments,
    reconciliationAuditEvents: audit
      ? [audit as any, ...(prev.reconciliationAuditEvents ?? [])]
      : prev.reconciliationAuditEvents,
  }));

  await afterApplyRefresh(deps, {
    effectiveDate,
    adjustmentId: adj?.id ?? null,
    reason,
    mechanism: preview.mechanism,
  });
  deps.toast?.('Balance reconciled.', 'success');
  return { ok: true, adjustment: adj ?? undefined, audit: audit ?? undefined };
}

async function applyRevaluation(
  deps: ReconciliationOrchestratorDeps,
  input: ApplyReconciliationInput,
  preview: {
    beforeValue: number;
    actualValue: number;
    delta: number;
    currency: 'SAR' | 'USD';
    mechanism: string;
  },
  reason: string,
  effectiveDate: string,
  clientNonce: string,
): Promise<ApplyReconciliationResult> {
  const data = deps.getData();
  const idempotencyKey = buildIdempotencyKey({
    userId: deps.userId,
    entityType: input.entityType,
    entityId: input.entityId,
    effectiveDate,
    mechanism: preview.mechanism,
    delta: preview.delta,
    reason,
    clientNonce,
  });

  if (input.entityType === 'asset') {
    const asset = (data.assets ?? []).find((a) => a.id === input.entityId);
    if (!asset) return { ok: false, error: 'Asset not found.' };
    await deps.updateAsset({ ...asset, value: roundMoney(preview.actualValue) });
  } else if (input.entityType === 'commodity') {
    const c = (data.commodityHoldings ?? []).find((h) => h.id === input.entityId);
    if (!c) return { ok: false, error: 'Commodity not found.' };
    await deps.updateCommodityHolding({ ...c, currentValue: roundMoney(preview.actualValue) });
  } else {
    const l = (data.liabilities ?? []).find((x) => x.id === input.entityId);
    if (!l) return { ok: false, error: 'Liability not found.' };
    await deps.updateLiability({ ...l, amount: roundMoney(preview.actualValue) });
    // Credit-linked mirror: keep the same signed amount as the liability (debt = negative).
    const creditAccountId =
      (l as Liability & { accountId?: string }).accountId ?? (l as { account_id?: string }).account_id;
    if (l.type === 'Credit Card' && creditAccountId) {
      const acc = (deps.getData().accounts ?? []).find((a) => a.id === creditAccountId);
      if (acc && acc.type === 'Credit') {
        await deps.updatePlatform({ ...acc, balance: roundMoney(preview.actualValue) }, { fromTransactionDelta: true });
      }
    }
  }

  const { data: adj, error: adjErr } = await insertReconciliationAdjustment(deps.db, deps.userId, {
    mechanism: preview.mechanism as any,
    entityType: input.entityType as any,
    entityId: input.entityId,
    effectiveDate,
    currency: preview.currency,
    beforeValue: preview.beforeValue,
    actualValue: preview.actualValue,
    delta: preview.delta,
    reason,
    idempotencyKey,
  });
  if (adjErr) return { ok: false, error: adjErr.message };

  const audit = await insertReconciliationAudit(deps.db, deps.userId, {
    kind: 'revaluation',
    mechanism: preview.mechanism,
    entityType: input.entityType,
    entityId: input.entityId,
    effectiveDate,
    beforeValue: preview.beforeValue,
    afterValue: preview.actualValue,
    delta: preview.delta,
    currency: preview.currency,
    reason,
    adjustmentId: adj?.id ?? null,
    summary: `${preview.mechanism}: ${preview.beforeValue} → ${preview.actualValue}`,
  });

  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    reconciliationAdjustments: adj
      ? [adj as any, ...(prev.reconciliationAdjustments ?? [])]
      : prev.reconciliationAdjustments,
    reconciliationAuditEvents: audit
      ? [audit as any, ...(prev.reconciliationAuditEvents ?? [])]
      : prev.reconciliationAuditEvents,
  }));
  await afterApplyRefresh(deps, {
    effectiveDate,
    adjustmentId: adj?.id ?? null,
    reason,
    mechanism: preview.mechanism,
  });
  deps.toast?.('Revaluation applied.', 'success');
  return { ok: true, adjustment: adj ?? undefined, audit: audit ?? undefined };
}

async function applySukukPrincipal(
  deps: ReconciliationOrchestratorDeps,
  input: ApplyReconciliationInput,
  preview: {
    beforeValue: number;
    actualValue: number;
    delta: number;
    currency: 'SAR' | 'USD';
    mechanism: string;
  },
  reason: string,
  effectiveDate: string,
  clientNonce: string,
): Promise<ApplyReconciliationResult> {
  const data = deps.getData();
  const position = (data.sukukPositions ?? []).find((p) => p.id === input.entityId);
  if (!position) return { ok: false, error: 'Sukuk position not found.' };
  if (!deps.updateSukukPosition) {
    return { ok: false, error: 'Sukuk restatement is unavailable in this context.' };
  }

  const restated: SukukPosition = {
    ...position,
    outstandingPrincipal: roundMoney(preview.actualValue),
    status: roundMoney(preview.actualValue) <= 0 ? 'completed' : position.status,
  };
  await deps.updateSukukPosition(restated, { viaReconciliation: true });
  // Posted payouts stay; only unposted future events are rebuilt from the restated principal.
  try {
    await deps.regenerateSukukFutureSchedule?.(position.id);
  } catch (e) {
    deps.toast?.(
      `Outstanding balance corrected, but the future payout schedule could not be regenerated: ${(e as Error)?.message ?? 'unknown error'}`,
      'info',
    );
  }

  const idempotencyKey = buildIdempotencyKey({
    userId: deps.userId,
    entityType: 'sukuk_position',
    entityId: position.id,
    effectiveDate,
    mechanism: preview.mechanism,
    delta: preview.delta,
    reason,
    clientNonce,
  });
  const { data: adj, error: adjErr } = await insertReconciliationAdjustment(deps.db, deps.userId, {
    mechanism: 'sukuk_face_yield',
    entityType: 'sukuk_position',
    entityId: position.id,
    accountId: position.investmentAccountId,
    effectiveDate,
    currency: preview.currency,
    beforeValue: preview.beforeValue,
    actualValue: preview.actualValue,
    delta: preview.delta,
    reason,
    idempotencyKey,
  });
  if (adjErr) return { ok: false, error: adjErr.message };

  const audit = await insertReconciliationAudit(deps.db, deps.userId, {
    kind: 'revaluation',
    mechanism: 'sukuk_face_yield',
    entityType: 'sukuk_position',
    entityId: position.id,
    effectiveDate,
    beforeValue: preview.beforeValue,
    afterValue: preview.actualValue,
    delta: preview.delta,
    currency: preview.currency,
    reason,
    adjustmentId: adj?.id ?? null,
    summary: `Sukuk outstanding corrected ${preview.beforeValue} → ${preview.actualValue} ${preview.currency} (${position.name})`,
    metadata: { faceValue: position.faceValue },
  });

  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    reconciliationAdjustments: adj
      ? [adj as any, ...(prev.reconciliationAdjustments ?? [])]
      : prev.reconciliationAdjustments,
    reconciliationAuditEvents: audit
      ? [audit as any, ...(prev.reconciliationAuditEvents ?? [])]
      : prev.reconciliationAuditEvents,
  }));
  await afterApplyRefresh(deps, {
    effectiveDate,
    adjustmentId: adj?.id ?? null,
    reason,
    mechanism: 'sukuk_face_yield',
  });
  deps.toast?.('Sukuk outstanding balance corrected.', 'success');
  return { ok: true, adjustment: adj ?? undefined, audit: audit ?? undefined };
}

/** Seal the hydrate cache and append a snapshot revision so corrected numbers survive refetch/refresh. */
async function afterApplyRefresh(
  deps: ReconciliationOrchestratorDeps,
  args: { effectiveDate: string; adjustmentId?: string | null; runId?: string | null; reason: string; mechanism: string },
): Promise<void> {
  deps.sealBookAfterAdjust?.();
  try {
    await deps.captureSnapshotRevision?.({
      snapshotDay: args.effectiveDate,
      adjustmentId: args.adjustmentId ?? null,
      runId: args.runId ?? null,
      reason: args.reason,
      mechanism: args.mechanism,
    });
  } catch (e) {
    console.warn('captureSnapshotRevision:', e);
  }
}

async function applyHoldingQty(
  deps: ReconciliationOrchestratorDeps,
  input: ApplyReconciliationInput,
  preview: {
    beforeValue: number;
    actualValue: number;
    delta: number;
    mechanism: string;
  },
  reason: string,
  effectiveDate: string,
  clientNonce: string,
): Promise<ApplyReconciliationResult> {
  const data = deps.getData();
  let holding: Holding | undefined;
  let portfolio: InvestmentPortfolio | undefined;
  for (const p of data.investments ?? []) {
    const h = (p.holdings ?? []).find((x) => x.id === input.entityId);
    if (h) {
      holding = h;
      portfolio = p;
      break;
    }
  }
  if (!holding || !portfolio) return { ok: false, error: 'Holding not found.' };

  const newQty = roundQuantity(preview.actualValue);
  if (newQty < 0) return { ok: false, error: 'Quantity cannot be negative.' };
  const beforeAvg = Number(holding.avgCost) || 0;
  const resolved = resolveHoldingReconcileBook({
    beforeQty: preview.beforeValue,
    actualQty: newQty,
    beforeAvgCost: beforeAvg,
    costBasisTotal: input.costBasisTotal,
    targetBookCost: input.targetBookCost,
    targetAvgCost: input.targetAvgCost,
  });
  const beforeBook = resolved.beforeBook;
  const avgCost = resolved.avgCost;

  if (preview.delta > 0 && resolved.mode === 'keep_wac') {
    return { ok: false, error: 'Increasing quantity requires total cost basis for added shares (or target book cost).' };
  }

  const markUnit =
    Number(holding.currentPrice) > 0
      ? Number(holding.currentPrice)
      : preview.beforeValue > 0
        ? Number(holding.currentValue || 0) / preview.beforeValue
        : 0;
  const updated: Holding = {
    ...holding,
    quantity: newQty,
    avgCost,
    currentValue: newQty <= 0 ? 0 : roundMoney(newQty * markUnit),
  };
  await deps.updateHolding(updated);
  deps.bumpHoldingsBookGeneration?.();

  /**
   * Always rebuild lots/PnL for this symbol after a book qty change (never rewrite qty again).
   * Backdated fixes also run the month-lock / marks gate so blocked cases surface instead of inventing ROI.
   * syncLotsForSymbols also FIFO-trims open lots to the new holding quantity.
   * Qty-down is a non-cash book correction — never post broker cash or investment ledger cash rows here.
   */
  const backdated = effectiveDate < appCalendarTodayYmd();
  let replayStatus: 'completed' | 'blocked' | 'failed' = 'completed';
  let replayError: string | null = null;
  if (backdated) {
    const replayed = await replayAffectedPortfolioSymbols({
      data: deps.getData(),
      request: {
        portfolioId: portfolio.id,
        symbols: [String(holding.symbol ?? '')],
        effectiveFrom: effectiveDate,
        requireHistoricalMarks: false,
      },
    });
    replayStatus = replayed.status === 'completed' ? 'completed' : (replayed.status as 'blocked' | 'failed');
    replayError = replayed.errorMessage ?? null;
  }
  if (replayStatus === 'completed' && deps.syncLotsForSymbols) {
    try {
      await deps.syncLotsForSymbols({
        portfolioId: portfolio.id,
        symbols: [String(holding.symbol ?? '')],
      });
    } catch (e) {
      replayStatus = 'failed';
      replayError = e instanceof Error ? e.message : String(e);
    }
  }

  /** After qty trim, rescale FIFO lot costs to the holding WAC book whenever align is requested. */
  const shouldAlignLotCosts = input.alignLotCostsToBook !== false && newQty > 0;
  if (shouldAlignLotCosts) {
    const sym = String(holding.symbol ?? '').toUpperCase();
    const targetBook = roundMoney(avgCost * newQty);
    let lotsForPersist: import('../../types').InvestmentCostLot[] | null = null;
    deps.applyFinancialDataPatch((prev) => {
      let lots = prev.investmentCostLots ?? [];
      const trimmed = alignOpenLotsToTargetQuantity(lots, sym, newQty);
      lots = rescaleOpenLotsToTargetBookCost(trimmed.lots, sym, targetBook);
      lotsForPersist = lots.filter((l) => l.portfolioId === portfolio.id);
      return { ...prev, investmentCostLots: lots };
    });
    if (deps.persistAlignedLotsForPortfolio && lotsForPersist) {
      try {
        await deps.persistAlignedLotsForPortfolio({ portfolioId: portfolio.id, lots: lotsForPersist });
      } catch (e) {
        console.warn('persistAlignedLotsForPortfolio:', e);
      }
    }
  }

  const runPayload = buildReplayRunPayload({
    userId: deps.userId,
    portfolioId: portfolio.id,
    symbols: [String(holding.symbol ?? '')],
    effectiveFrom: effectiveDate,
  });
  const run = await insertReconciliationRun(deps.db, deps.userId, {
    status: replayStatus,
    effectiveFrom: effectiveDate,
    entityType: 'holding',
    entityIds: [holding.id],
    errorMessage: replayError,
    metadata: {
      ...runPayload.metadata,
      symbol: holding.symbol,
      backdated,
      beforeAvgCost: beforeAvg,
      afterAvgCost: avgCost,
      beforeBookCost: beforeBook,
      afterBookCost: roundMoney(avgCost * newQty),
      targetAvgCost: input.targetAvgCost ?? null,
      targetBookCost: input.targetBookCost ?? null,
    },
  });
  if (replayError) {
    deps.toast?.(replayError, 'info');
  }

  const idempotencyKey = buildIdempotencyKey({
    userId: deps.userId,
    entityType: 'holding',
    entityId: holding.id,
    effectiveDate,
    mechanism: 'reconcile_quantity',
    delta: preview.delta,
    reason,
    clientNonce,
  });
  const bookCurrency: 'SAR' | 'USD' = portfolio.currency === 'SAR' ? 'SAR' : 'USD';
  const afterBook = roundMoney(avgCost * newQty);
  const storedCostBasis =
    resolved.mode === 'target_book'
      ? Number(input.targetBookCost)
      : resolved.mode === 'add_cost'
        ? Number(input.costBasisTotal)
        : resolved.mode === 'target_avg' && newQty > 0
          ? afterBook
          : preview.delta < 0
            ? beforeBook
            : afterBook;
  const { data: adj, error: adjErr } = await insertReconciliationAdjustment(deps.db, deps.userId, {
    mechanism: 'reconcile_quantity',
    entityType: 'holding',
    entityId: holding.id,
    portfolioId: portfolio.id,
    symbol: holding.symbol,
    accountId: portfolio.accountId,
    effectiveDate,
    currency: bookCurrency,
    beforeValue: preview.beforeValue,
    actualValue: preview.actualValue,
    delta: preview.delta,
    costBasisTotal: storedCostBasis,
    reason,
    idempotencyKey,
  });
  if (adjErr) return { ok: false, error: adjErr.message };

  const audit = await insertReconciliationAudit(deps.db, deps.userId, {
    kind: 'adjustment',
    mechanism: 'reconcile_quantity',
    entityType: 'holding',
    entityId: holding.id,
    effectiveDate,
    beforeValue: preview.beforeValue,
    afterValue: preview.actualValue,
    delta: preview.delta,
    reason,
    adjustmentId: adj?.id ?? null,
    runId: run?.id ?? null,
    summary: `Reconcile holding ${holding.symbol}: qty ${preview.beforeValue} → ${preview.actualValue}, avg ${beforeAvg.toFixed(4)} → ${avgCost.toFixed(4)}`,
    metadata: {
      beforeAvgCost: beforeAvg,
      afterAvgCost: avgCost,
      beforeBookCost: beforeBook,
      afterBookCost: roundMoney(avgCost * newQty),
    },
  });

  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    reconciliationAdjustments: adj
      ? [adj as any, ...(prev.reconciliationAdjustments ?? [])]
      : prev.reconciliationAdjustments,
    reconciliationAuditEvents: audit
      ? [audit as any, ...(prev.reconciliationAuditEvents ?? [])]
      : prev.reconciliationAuditEvents,
    reconciliationRuns: run ? [run as any, ...(prev.reconciliationRuns ?? [])] : prev.reconciliationRuns,
  }));
  await afterApplyRefresh(deps, {
    effectiveDate,
    adjustmentId: adj?.id ?? null,
    runId: run?.id ?? null,
    reason,
    mechanism: 'reconcile_quantity',
  });
  const costRestated =
    resolved.mode === 'target_book' ||
    resolved.mode === 'target_avg' ||
    resolved.mode === 'add_cost' ||
    Math.abs(avgCost - beforeAvg) > 1e-9;
  deps.toast?.(
    costRestated ? 'Holding quantity / cost basis reconciled.' : 'Holding quantity reconciled.',
    'success',
  );
  return { ok: true, adjustment: adj ?? undefined, audit: audit ?? undefined, run };
}

export async function orchestrateReverseReconciliation(
  deps: ReconciliationOrchestratorDeps,
  adjustmentId: string,
  reason: string,
): Promise<ApplyReconciliationResult> {
  if (!isValidReason(reason)) {
    return { ok: false, error: 'Reason is required (at least 3 characters).' };
  }
  const roleBlock = roleBlocksAdjustments(deps.userRole);
  if (roleBlock) return { ok: false, error: roleBlock };
  const data = deps.getData();
  let adj = (data.reconciliationAdjustments ?? []).find((a) => a.id === adjustmentId) as
    | ReconciliationAdjustment
    | undefined;
  if (!adj) {
    const { data: row } = await deps.db
      .from('reconciliation_adjustments')
      .select('*')
      .eq('id', adjustmentId)
      .eq('user_id', deps.userId)
      .maybeSingle();
    if (row) adj = normalizeReconciliationAdjustmentRow(row as Record<string, unknown>);
  }
  const block = assertCanReverseAdjustment(adj);
  if (block || !adj) return { ok: false, error: block ?? 'Adjustment not found.' };

  // Prefer RPC for cash
  if (adj.entityType === 'account' && (adj.mechanism === 'reconcile_balance' || adj.mechanism === 'opening_balance')) {
    const { data: rpcData, error: rpcErr } = await deps.db.rpc('reverse_reconciliation_adjustment', {
      p_adjustment_id: adjustmentId,
      p_reason: normalizeReason(reason),
    });
    if (!rpcErr && rpcData && (rpcData as any).ok) {
      await afterApplyRefresh(deps, {
        effectiveDate: appCalendarTodayYmd(),
        adjustmentId,
        reason: normalizeReason(reason),
        mechanism: 'reverse_adjustment',
      });
      deps.toast?.('Adjustment reversed.', 'success');
      return { ok: true };
    }
    if (rpcErr && !/could not find|PGRST|function|schema cache|404/i.test(String(rpcErr.message))) {
      return { ok: false, error: rpcErr.message };
    }
  }

  const targets = reverseTargets(adj);
  if (adj.entityType === 'account') {
    const account = (data.accounts ?? []).find((a) => a.id === adj!.entityId);
    if (!account) return { ok: false, error: 'Account not found.' };
    if (account.type === 'Investment') {
      const row = buildReverseBrokerCashRow({
        accountId: account.id,
        original: adj,
        reason: normalizeReason(reason),
      });
      await deps.recordBrokerCashAdjust(row);
    } else {
      const tx = buildReverseCashLedgerTx({
        account,
        original: adj,
        reason: normalizeReason(reason),
      });
      await deps.addTransaction(tx, { system: true });
    }
  } else if (adj.entityType === 'asset') {
    const asset = (data.assets ?? []).find((a) => a.id === adj!.entityId);
    if (!asset) return { ok: false, error: 'Asset not found.' };
    await deps.updateAsset({ ...asset, value: roundMoney(targets.actualValue) });
  } else if (adj.entityType === 'commodity') {
    const c = (data.commodityHoldings ?? []).find((h) => h.id === adj!.entityId);
    if (!c) return { ok: false, error: 'Commodity not found.' };
    await deps.updateCommodityHolding({ ...c, currentValue: roundMoney(targets.actualValue) });
  } else if (adj.entityType === 'liability') {
    const l = (data.liabilities ?? []).find((x) => x.id === adj!.entityId);
    if (!l) return { ok: false, error: 'Liability not found.' };
    await deps.updateLiability({ ...l, amount: roundMoney(targets.actualValue) });
    const creditAccountId =
      (l as Liability & { accountId?: string }).accountId ?? (l as { account_id?: string }).account_id;
    if (l.type === 'Credit Card' && creditAccountId) {
      const acc = (deps.getData().accounts ?? []).find((a) => a.id === creditAccountId);
      if (acc && acc.type === 'Credit') {
        await deps.updatePlatform(
          { ...acc, balance: roundMoney(targets.actualValue) },
          { fromTransactionDelta: true },
        );
      }
    }
  } else if (adj.entityType === 'sukuk_position') {
    const p = (data.sukukPositions ?? []).find((x) => x.id === adj!.entityId);
    if (!p) return { ok: false, error: 'Sukuk position not found.' };
    if (!deps.updateSukukPosition) return { ok: false, error: 'Sukuk restatement is unavailable in this context.' };
    const restoredPrincipal = roundMoney(targets.actualValue);
    await deps.updateSukukPosition(
      {
        ...p,
        outstandingPrincipal: restoredPrincipal,
        status: restoredPrincipal > 0 && p.status === 'completed' ? 'active' : p.status,
      },
      { viaReconciliation: true },
    );
    try {
      await deps.regenerateSukukFutureSchedule?.(p.id);
    } catch (e) {
      console.warn('regenerateSukukFutureSchedule (reverse):', e);
    }
  } else if (adj.entityType === 'holding') {
    // Reverse qty (+ best-effort avgCost from stored costBasisTotal) and rebuild lots for that symbol only.
    for (const p of data.investments ?? []) {
      const h = (p.holdings ?? []).find((x) => x.id === adj!.entityId);
      if (h) {
        const restoredQty = roundQuantity(targets.actualValue);
        let avgCost = Number(h.avgCost) || 0;
        const costBasis = Number(adj.costBasisTotal);
        if (Number.isFinite(costBasis) && costBasis >= 0 && restoredQty > 0 && adj.delta > 0) {
          // Original apply increased qty with costBasisTotal for the added shares — reverse by removing that cost.
          const currentCost = avgCost * Number(h.quantity);
          const restoredCost = Math.max(0, currentCost - costBasis);
          avgCost = restoredQty > 0 ? roundAvgCostPerUnit(restoredCost / restoredQty) : 0;
        } else if (Number.isFinite(costBasis) && costBasis >= 0 && restoredQty > 0 && adj.delta < 0) {
          // Original apply decreased qty — restore prior WAC from before*beforeAvg ≈ costBasis when provided as total book cost.
          avgCost = roundAvgCostPerUnit(costBasis / restoredQty);
        }
        await deps.updateHolding({
          ...h,
          quantity: restoredQty,
          avgCost,
          currentValue: (() => {
            if (restoredQty <= 0) return 0;
            const markUnit =
              Number(h.currentPrice) > 0
                ? Number(h.currentPrice)
                : Number(h.quantity) > 0
                  ? Number(h.currentValue || 0) / Number(h.quantity)
                  : 0;
            return roundMoney(restoredQty * markUnit);
          })(),
        });
        deps.bumpHoldingsBookGeneration?.();
        if (deps.syncLotsForSymbols) {
          try {
            await deps.syncLotsForSymbols({
              portfolioId: p.id,
              symbols: [String(h.symbol ?? '')],
            });
          } catch (e) {
            console.warn('syncLotsForSymbols (reverse holding):', e);
          }
        }
        break;
      }
    }
  } else if (adj.entityType === 'investment_transaction') {
    if (!deps.reverseInvestmentTransactionEdit) {
      return { ok: false, error: 'Investment transaction reverse is unavailable in this context.' };
    }
    await deps.reverseInvestmentTransactionEdit(adj);
  } else {
    return { ok: false, error: `Reverse not supported for ${adj.entityType} in client path.` };
  }

  const idempotencyKey = `reverse|${adj.id}`;
  const { data: revAdj, error: revErr } = await insertReconciliationAdjustment(deps.db, deps.userId, {
    mechanism: 'reverse_adjustment',
    entityType: adj.entityType,
    entityId: adj.entityId,
    portfolioId: adj.portfolioId,
    accountId: adj.accountId,
    symbol: adj.symbol,
    effectiveDate: appCalendarTodayYmd(),
    currency: adj.currency,
    beforeValue: targets.beforeValue,
    actualValue: targets.actualValue,
    delta: targets.delta,
    reason: normalizeReason(reason),
    idempotencyKey,
    reversesAdjustmentId: adj.id,
  });
  if (revErr) return { ok: false, error: revErr.message };
  if (revAdj) await markAdjustmentReversed(deps.db, deps.userId, adj.id, revAdj.id);

  const audit = await insertReconciliationAudit(deps.db, deps.userId, {
    kind: 'reversal',
    mechanism: 'reverse_adjustment',
    entityType: adj.entityType,
    entityId: adj.entityId,
    effectiveDate: appCalendarTodayYmd(),
    beforeValue: targets.beforeValue,
    afterValue: targets.actualValue,
    delta: targets.delta,
    currency: adj.currency,
    reason: normalizeReason(reason),
    adjustmentId: revAdj?.id ?? null,
    summary: `Reversed adjustment ${adj.id}`,
    metadata: { reversesAdjustmentId: adj.id },
  });

  deps.applyFinancialDataPatch((prev) => ({
    ...prev,
    reconciliationAdjustments: [
      ...(revAdj ? [revAdj as any] : []),
      ...(prev.reconciliationAdjustments ?? []).map((a) =>
        a.id === adj!.id ? { ...a, status: 'reversed', reversedByAdjustmentId: revAdj?.id } : a,
      ),
    ],
    reconciliationAuditEvents: audit
      ? [audit as any, ...(prev.reconciliationAuditEvents ?? [])]
      : prev.reconciliationAuditEvents,
  }));
  await afterApplyRefresh(deps, {
    effectiveDate: appCalendarTodayYmd(),
    adjustmentId: revAdj?.id ?? null,
    reason: normalizeReason(reason),
    mechanism: 'reverse_adjustment',
  });
  deps.toast?.('Adjustment reversed.', 'success');
  return { ok: true, adjustment: revAdj ?? undefined, audit: audit ?? undefined };
}
