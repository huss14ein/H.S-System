import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal';
import {
  accountHasLedgerActivity,
  appCalendarTodayYmd,
  isValidReason,
  previewCashAccountReconcile,
  type ReconciliationPreview,
} from '../../services/reconciliation';
import type { Account } from '../../types';

export interface ReconcileBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  transactions?: { accountId?: string; category?: string }[];
  /** Broker platforms record activity in the investment ledger — required to tell a fresh platform from an active one. */
  investmentTransactions?: { accountId?: string; portfolioId?: string }[];
  /** Portfolio ids mapped to this account (legacy rows may carry only `portfolioId`). */
  portfolioIds?: string[];
  onApply: (args: {
    accountId: string;
    actualValue: number;
    reason: string;
    effectiveDate: string;
    confirmBackdated: boolean;
    mechanism: 'reconcile_balance' | 'opening_balance';
  }) => Promise<void>;
}

const ReconcileBalanceModal: React.FC<ReconcileBalanceModalProps> = ({
  isOpen,
  onClose,
  account,
  transactions,
  investmentTransactions,
  portfolioIds,
  onApply,
}) => {
  const [actualStr, setActualStr] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(appCalendarTodayYmd());
  const [confirmBackdated, setConfirmBackdated] = useState(false);
  const [useOpeningBalance, setUseOpeningBalance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ledgerEmpty = useMemo(() => {
    if (!account) return false;
    return !accountHasLedgerActivity(account.id, transactions as any, {
      investmentTransactions,
      portfolioIds,
    });
  }, [account, transactions, investmentTransactions, portfolioIds]);

  useEffect(() => {
    if (!isOpen || !account) return;
    setActualStr(String(account.balance ?? ''));
    setReason('');
    setEffectiveDate(appCalendarTodayYmd());
    setConfirmBackdated(false);
    setUseOpeningBalance(ledgerEmpty);
    setError(null);
  }, [isOpen, account, ledgerEmpty]);

  const mechanism = useOpeningBalance && ledgerEmpty ? 'opening_balance' : 'reconcile_balance';

  const preview: ReconciliationPreview | null = useMemo(() => {
    if (!account) return null;
    const actual = Number(String(actualStr).replace(/,/g, ''));
    if (!Number.isFinite(actual)) return null;
    return previewCashAccountReconcile({
      account,
      actualValue: actual,
      transactions: transactions as any,
      investmentTransactions,
      portfolioIds,
      mechanism,
      effectiveDate,
      reason,
      confirmBackdated,
    });
  }, [
    account,
    actualStr,
    transactions,
    investmentTransactions,
    portfolioIds,
    mechanism,
    effectiveDate,
    reason,
    confirmBackdated,
  ]);

  if (!account) return null;
  const currency = account.currency === 'USD' ? 'USD' : 'SAR';
  const today = appCalendarTodayYmd();
  const isBackdated = effectiveDate < today;
  const title =
    mechanism === 'opening_balance'
      ? `Opening Balance — ${account.name}`
      : `Reconcile Balance — ${account.name}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidReason(reason)) {
      setError('Reason is required (at least 3 characters).');
      return;
    }
    const actual = Number(String(actualStr).replace(/,/g, ''));
    if (!Number.isFinite(actual)) {
      setError('Enter a valid actual balance.');
      return;
    }
    if (preview?.blockedReason) {
      setError(preview.blockedReason);
      return;
    }
    if (preview?.noop) {
      setError(null);
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onApply({
        accountId: account.id,
        actualValue: actual,
        reason,
        effectiveDate,
        confirmBackdated: isBackdated ? confirmBackdated : false,
        mechanism,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Enter the balance on your statement. The system posts a single delta transaction — it does not overwrite
          history.
        </p>
        {ledgerEmpty ? (
          <label className="flex items-start gap-2 text-sm text-slate-700 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={useOpeningBalance}
              onChange={(e) => setUseOpeningBalance(e.target.checked)}
            />
            <span>
              <strong>Opening Balance</strong> — this account has no ledger activity yet. Post as an Opening Balance
              event (allowed only on first reconcile). Uncheck to post as a normal Reconciliation Adjustment.
            </span>
          </label>
        ) : (
          <p className="text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50 p-2">
            Ledger already has activity — Opening Balance is locked. Later corrections always use Reconciliation
            Adjustment.
          </p>
        )}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums">
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">System balance</span>
            <span className="font-medium text-slate-900">
              {Number(account.balance ?? 0).toFixed(2)} {currency}
            </span>
          </div>
          {preview && (
            <div className="mt-2 flex justify-between gap-2">
              <span className="text-slate-600">Delta</span>
              <span className={preview.noop ? 'text-slate-500' : 'font-semibold text-slate-900'}>
                {preview.delta >= 0 ? '+' : ''}
                {preview.delta.toFixed(2)} {currency}
                {preview.noop ? ' (already matches)' : ''}
              </span>
            </div>
          )}
          <div className="mt-2 flex justify-between gap-2 text-xs">
            <span className="text-slate-500">Category</span>
            <span className="font-medium text-slate-700">
              {mechanism === 'opening_balance' ? 'Opening Balance' : 'Reconciliation Adjustment'}
            </span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Actual balance ({currency})</label>
          <input
            type="number"
            step="any"
            className="input-base"
            value={actualStr}
            onChange={(e) => setActualStr(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Effective date</label>
          <input
            type="date"
            className="input-base"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            required
          />
          {isBackdated && (
            <label className="mt-2 flex items-start gap-2 text-xs text-amber-800">
              <input
                type="checkbox"
                checked={confirmBackdated}
                onChange={(e) => setConfirmBackdated(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand this backdated adjustment will appear in cashflow from this date forward.
              </span>
            </label>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason (required)</label>
          <input
            type="text"
            className="input-base"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Match July 25 bank statement"
            required
            minLength={3}
          />
        </div>
        {preview?.impacts?.length ? (
          <ul className="text-xs text-slate-600 list-disc pl-4 space-y-1">
            {preview.impacts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="btn-outline flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy || Boolean(preview?.noop)}>
            {busy
              ? 'Applying…'
              : preview?.noop
                ? 'Already matches'
                : mechanism === 'opening_balance'
                  ? 'Post opening balance'
                  : 'Apply reconcile'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ReconcileBalanceModal;
