/**
 * Unacked Checking/Savings/Credit balance-vs-ledger warnings with Keep stored balance.
 * Dismissals sync via settings.ui_acks (same fingerprint family as Reconcile Balance Apply).
 */
import React, { useContext, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { DataContext } from '../../context/DataContext';
import { toast } from '../../context/ToastContext';
import {
  reconcileCashAccountBalance,
  reconcileCreditAccountBalance,
} from '../../services/dataQuality';
import {
  acknowledgeCashBalanceDriftDurable,
  filterUnackedCashDriftWarnings,
  resolveCashBalanceDriftAcks,
} from '../../services/uiAcks';
import { getPersonalAccounts, getPersonalTransactions } from '../../utils/wealthScope';
import type { Account } from '../../types';

type Props = {
  /** Prefer opening Reconcile for this account when provided. */
  onReconcile?: (account: Account) => void;
};

function safeAccountLabel(name: string | undefined, id: string): string {
  const raw = String(name ?? '').trim() || id;
  return raw.slice(0, 80);
}

const CashBalanceDriftBanner: React.FC<Props> = ({ onReconcile }) => {
  const ctx = useContext(DataContext);
  const auth = useContext(AuthContext);
  const data = ctx?.data;
  const userId = auth?.user?.id ?? null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyLockRef = useRef(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const accounts = getPersonalAccounts(data) as Account[];
    const txs = getPersonalTransactions(data);
    const acks = resolveCashBalanceDriftAcks(userId, data.settings);
    const raw = accounts
      .filter((a) => a.type === 'Checking' || a.type === 'Savings' || a.type === 'Credit')
      .map((a) => {
        const r =
          a.type === 'Credit'
            ? reconcileCreditAccountBalance(a, txs)
            : reconcileCashAccountBalance(a, txs);
        if (!r || !r.showWarning) return null;
        return {
          ...r,
          account: a,
          label: safeAccountLabel(a.name, a.id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    return filterUnackedCashDriftWarnings(raw, acks);
  }, [userId, data?.settings?.uiAcks, data?.accounts, data?.transactions]);

  if (!data || rows.length === 0 || !ctx?.updateSettings) return null;

  const keepStored = (row: (typeof rows)[number]) => {
    if (busyLockRef.current) return;
    busyLockRef.current = true;
    setBusyId(row.accountId);
    void (async () => {
      try {
        await acknowledgeCashBalanceDriftDurable({
          userId,
          accountId: row.accountId,
          storedBalance: row.storedBalance,
          transactionNet: row.transactionNet,
          currentUiAcks: data.settings?.uiAcks,
          persistUiAcks: async (partial) => {
            // Pass only the partial map — updateSettings merges against dataRef so sibling acks stay fresh.
            await ctx.updateSettings({ uiAcks: partial });
          },
        });
        toast(`Kept stored balance for ${row.label} — warning dismissed until drift changes.`, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not save dismissal.', 'error');
      } finally {
        busyLockRef.current = false;
        setBusyId(null);
      }
    })();
  };

  return (
    <section
      data-testid="cash-balance-drift-banner"
      className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 mb-4"
    >
      <h3 className="text-sm font-semibold text-amber-950 mb-1">Balance vs transaction ledger</h3>
      <p className="text-xs text-amber-900/90 mb-3 leading-relaxed">
        Stored balance does not match Σ(transactions). Use <span className="font-semibold">Reconcile</span> to post an
        audited delta, or <span className="font-semibold">Keep stored balance</span> if the bank book is correct and
        history is incomplete — dismissals sync across devices.
      </p>
      <ul className="space-y-2">
        {rows.slice(0, 8).map((r) => (
          <li
            key={r.accountId}
            className="flex flex-wrap items-center justify-between gap-2 border border-amber-200 rounded-lg px-3 py-2 bg-white"
          >
            <span>
              <span className="font-medium text-slate-900">{r.label}</span>
              <span className="block text-xs text-slate-600 mt-0.5">
                Stored {r.storedBalance.toLocaleString()} · ledger {r.transactionNet.toLocaleString()} · drift{' '}
                {r.drift >= 0 ? '+' : ''}
                {r.drift.toLocaleString()}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid={`keep-cash-balance-${r.accountId}`}
                disabled={busyId === r.accountId}
                className="text-xs px-2.5 py-1.5 rounded-md border border-slate-400 text-slate-900 bg-white hover:bg-slate-100 font-medium disabled:opacity-50"
                onClick={() => keepStored(r)}
              >
                {busyId === r.accountId ? 'Saving…' : 'Keep stored balance'}
              </button>
              {onReconcile && (
                <button
                  type="button"
                  className="text-xs px-2.5 py-1.5 rounded-md border border-emerald-400 text-emerald-900 bg-emerald-50 hover:bg-emerald-100 font-medium"
                  onClick={() => onReconcile(r.account)}
                >
                  Reconcile…
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default CashBalanceDriftBanner;
