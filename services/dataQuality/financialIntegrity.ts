import type { Account, Transaction } from '../../types';
import { reconcileCashAccountBalance, reconcileCreditAccountBalance, transactionNetForAccount } from './accountReconciliation';

const MONEY_EPSILON = 0.0001;

export type IntegritySeverity = 'info' | 'warning' | 'critical';

export interface IntegrityIssue {
  code:
    | 'INVALID_ACCOUNT_BALANCE'
    | 'INVALID_TRANSACTION_AMOUNT'
    | 'MISSING_ACCOUNT_LINK'
    | 'ACCOUNT_LINK_NOT_FOUND'
    | 'ACCOUNT_BALANCE_DRIFT'
    | 'TRANSFER_GROUP_MISSING_LEG'
    | 'TRANSFER_GROUP_AMOUNT_MISMATCH'
    | 'UNPAIRED_TRANSFER';
  severity: IntegritySeverity;
  message: string;
  accountId?: string;
  transactionId?: string;
  transferGroupId?: string;
}

export interface AccountLedgerSummary {
  accountId: string;
  accountType: Account['type'];
  storedBalance: number;
  transactionNet: number;
  drift: number;
  transactionCount: number;
}

export interface TransferGroupSummary {
  transferGroupId: string;
  outAmount: number;
  inAmount: number;
  outAmountSar: number;
  inAmountSar: number;
  feeAmount: number;
  outCount: number;
  inCount: number;
  feeCount: number;
}

export interface FinancialIntegrityReport {
  isAccurate: boolean;
  issues: IntegrityIssue[];
  accountSummaries: AccountLedgerSummary[];
  transferGroups: TransferGroupSummary[];
}

function isFiniteMoney(v: unknown): boolean {
  return Number.isFinite(Number(v));
}

/**
 * Full-ledger integrity report for accounting/audit controls.
 * Scope:
 * - numeric sanity on balances/amounts
 * - account linkage and referential checks
 * - per-account ledger-vs-balance reconciliation
 * - transfer group completeness and amount matching
 */
export function buildFinancialIntegrityReport(
  accounts: Account[],
  transactions: Transaction[],
  options?: { sarPerUsd?: number }
): FinancialIntegrityReport {
  const issues: IntegrityIssue[] = [];
  const allAccounts = accounts ?? [];
  const allTransactions = transactions ?? [];
  const accountIds = new Set(allAccounts.map((a) => a.id));
  const sarPerUsd = Number.isFinite(Number(options?.sarPerUsd)) && Number(options?.sarPerUsd) > 0
    ? Number(options?.sarPerUsd)
    : 3.75;
  const accountCurrencyById = new Map(
    allAccounts.map((a) => [a.id, (a.currency === 'USD' ? 'USD' : 'SAR') as 'USD' | 'SAR'])
  );
  const toSar = (amountAbs: number, accountId?: string) => {
    const c = accountId ? accountCurrencyById.get(accountId) : 'SAR';
    return (c === 'USD' ? amountAbs * sarPerUsd : amountAbs);
  };

  for (const a of allAccounts) {
    if (!isFiniteMoney(a.balance)) {
      issues.push({
        code: 'INVALID_ACCOUNT_BALANCE',
        severity: 'critical',
        accountId: a.id,
        message: `Account ${a.id} has a non-finite balance.`,
      });
    }
  }

  for (const t of allTransactions) {
    if (!isFiniteMoney(t.amount) || Math.abs(Number(t.amount)) < MONEY_EPSILON) {
      issues.push({
        code: 'INVALID_TRANSACTION_AMOUNT',
        severity: 'critical',
        transactionId: t.id,
        accountId: t.accountId,
        message: `Transaction ${t.id} has an invalid amount.`,
      });
    }
    if (!t.accountId || String(t.accountId).trim() === '') {
      issues.push({
        code: 'MISSING_ACCOUNT_LINK',
        severity: 'critical',
        transactionId: t.id,
        message: `Transaction ${t.id} is missing account linkage.`,
      });
    } else if (!accountIds.has(t.accountId)) {
      issues.push({
        code: 'ACCOUNT_LINK_NOT_FOUND',
        severity: 'critical',
        transactionId: t.id,
        accountId: t.accountId,
        message: `Transaction ${t.id} references unknown account ${t.accountId}.`,
      });
    }
    if (t.category?.trim().toLowerCase() === 'transfer' && !t.transferGroupId) {
      issues.push({
        code: 'UNPAIRED_TRANSFER',
        severity: 'warning',
        transactionId: t.id,
        accountId: t.accountId,
        message: `Transfer transaction ${t.id} has no transferGroupId.`,
      });
    }
  }

  const accountSummaries: AccountLedgerSummary[] = allAccounts.map((a) => {
    const txCount = allTransactions.filter((t) => t.accountId === a.id).length;
    const net = transactionNetForAccount(a.id, allTransactions);
    const storedBalance = Number(a.balance) || 0;
    const drift = storedBalance - net;
    return {
      accountId: a.id,
      accountType: a.type,
      storedBalance,
      transactionNet: net,
      drift,
      transactionCount: txCount,
    };
  });

  for (const a of allAccounts) {
    const cashRec = reconcileCashAccountBalance(a, allTransactions);
    if (cashRec?.showWarning) {
      issues.push({
        code: 'ACCOUNT_BALANCE_DRIFT',
        severity: 'warning',
        accountId: a.id,
        message: `Cash account ${a.id} drift is ${cashRec.drift.toFixed(2)}.`,
      });
    }
    const creditRec = reconcileCreditAccountBalance(a, allTransactions);
    if (creditRec?.showWarning) {
      issues.push({
        code: 'ACCOUNT_BALANCE_DRIFT',
        severity: 'warning',
        accountId: a.id,
        message: `Credit account ${a.id} drift is ${creditRec.drift.toFixed(2)}.`,
      });
    }
  }

  const groups = new Map<string, Transaction[]>();
  for (const t of allTransactions) {
    if (!t.transferGroupId) continue;
    const bucket = groups.get(t.transferGroupId) ?? [];
    bucket.push(t);
    groups.set(t.transferGroupId, bucket);
  }

  const transferGroups: TransferGroupSummary[] = [];
  for (const [gid, txs] of groups) {
    const outRows = txs.filter((t) => t.transferRole === 'principal_out');
    const inRows = txs.filter((t) => t.transferRole === 'principal_in');
    const feeRows = txs.filter((t) => t.transferRole === 'fee');
    const outAmount = outRows.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
    const inAmount = inRows.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
    const outAmountSar = outRows.reduce((s, t) => s + toSar(Math.abs(Number(t.amount) || 0), t.accountId), 0);
    const inAmountSar = inRows.reduce((s, t) => s + toSar(Math.abs(Number(t.amount) || 0), t.accountId), 0);
    const feeAmount = feeRows.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);

    transferGroups.push({
      transferGroupId: gid,
      outAmount,
      inAmount,
      outAmountSar,
      inAmountSar,
      feeAmount,
      outCount: outRows.length,
      inCount: inRows.length,
      feeCount: feeRows.length,
    });

    if (outRows.length === 0 || inRows.length === 0) {
      issues.push({
        code: 'TRANSFER_GROUP_MISSING_LEG',
        severity: 'critical',
        transferGroupId: gid,
        message: `Transfer group ${gid} is missing a principal in/out leg.`,
      });
      continue;
    }

    if (Math.abs(outAmountSar - inAmountSar) > 0.01) {
      issues.push({
        code: 'TRANSFER_GROUP_AMOUNT_MISMATCH',
        severity: 'warning',
        transferGroupId: gid,
        message: `Transfer group ${gid} principal mismatch (SAR-normalized): out ${outAmountSar.toFixed(2)} vs in ${inAmountSar.toFixed(2)}.`,
      });
    }
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const hasWarning = issues.some((i) => i.severity === 'warning');
  return {
    isAccurate: !hasCritical && !hasWarning,
    issues,
    accountSummaries,
    transferGroups,
  };
}
