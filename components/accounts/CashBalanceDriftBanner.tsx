/**
 * Unacked Checking/Savings/Credit balance-vs-ledger warnings with Keep stored balance.
 * Dismissals sync via settings.ui_acks (same fingerprint family as Reconcile Balance Apply).
 */
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  mergeUiAcks,
  normalizeUiAcks,
  resolveCashBalanceDriftAcks,
  type CashBalanceDriftAckMap,
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
  const isBackgroundSyncing = Boolean(ctx?.isBackgroundSyncing);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyLockRef = useRef(false);
  /** Serialize banner persists the same way Apply does — avoid multi-card Keep stored races. */
  const persistChainRef = useRef(Promise.resolve());
  const [acks, setAcks] = useState<CashBalanceDriftAckMap>(() =>
    resolveCashBalanceDriftAcks(userId, data?.settings),
  );

  useEffect(() => {
    setAcks(resolveCashBalanceDriftAcks(userId, data?.settings, { writeThrough: true }));
  }, [userId, data?.settings?.uiAcks]);

  const rows = useMemo(() => {
    if (!data) return [];
    const accounts = getPersonalAccounts(data) as Account[];
    const txs = getPersonalTransactions(data);
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
  }, [acks, data?.accounts, data?.transactions, data?.personalAccounts, data?.personalTransactions]);

  if (!data || rows.length === 0 || !ctx?.updateSettings) return null;

  const keepStored = (row: (typeof rows)[number]) => {
    if (busyLockRef.current) return;
    if (isBackgroundSyncing) {
      toast('Still loading transactions — wait a moment, then dismiss again so the fingerprint matches the full ledger.', 'info');
      return;
    }
    busyLockRef.current = true;
    setBusyId(row.accountId);
    void (async () => {
      try {
        /** Recompute from the latest book — never ack a stale row fingerprint after mid-flight hydrate. */
        const live = ctx.data;
        if (!live) throw new Error('Data unavailable');
        const liveAcc = (getPersonalAccounts(live) as Account[]).find((a) => a.id === row.accountId);
        if (!liveAcc) throw new Error('Account not found');
        const liveTxs = getPersonalTransactions(live);
        const liveRec =
          liveAcc.type === 'Credit'
            ? reconcileCreditAccountBalance(liveAcc, liveTxs)
            : reconcileCashAccountBalance(liveAcc, liveTxs);
        if (!liveRec || !liveRec.showWarning) {
          setAcks(resolveCashBalanceDriftAcks(userId, live.settings, { writeThrough: true }));
          toast(`No open drift for ${row.label}.`, 'info');
          return;
        }

        const persistUiAcks = (partial: import('../../services/uiAcks').UiAcks) => {
          persistChainRef.current = persistChainRef.current
            .catch(() => undefined)
            .then(async () => {
              const latest = normalizeUiAcks(ctx.data?.settings?.uiAcks);
              await ctx.updateSettings!({ uiAcks: mergeUiAcks(latest, partial) });
            });
          return persistChainRef.current;
        };

        const next = await acknowledgeCashBalanceDriftDurable({
          userId,
          accountId: liveRec.accountId,
          storedBalance: liveRec.storedBalance,
          transactionNet: liveRec.transactionNet,
          currentUiAcks: live.settings?.uiAcks,
          persistUiAcks,
        });
        setAcks(next);
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
        history is incomplete — dismissals sync across devices and stay until the stored balance or ledger net changes.
      </p>
      {isBackgroundSyncing && (
        <p className="text-xs text-amber-800 mb-2 font-medium">
          Loading full transaction history… dismissals are more reliable after sync finishes.
        </p>
      )}
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
                disabled={busyId === r.accountId || isBackgroundSyncing}
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
