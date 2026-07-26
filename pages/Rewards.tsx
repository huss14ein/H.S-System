import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { isRestrictedRole } from '../utils/role';
import {
  REWARDS_PROVIDER_TEMPLATES,
  createRewardsAccount,
  fiatEquivalentFromPoints,
  postRewardsLedgerEvent,
  redeemRewards,
  reverseRewardsRedemption,
  transferRewards,
  rewardsExpiringWithinDays,
  sumRewardsFiatSar,
  type RewardsRedeemTarget,
} from '../services/rewards';
import type { Page, RewardsAccount } from '../types';
import { scheduleClearPageAction } from '../utils/scheduleClearPageAction';

interface RewardsPageProps {
  pageAction?: string | null;
  clearPageAction?: () => void;
  setActivePage?: (page: Page) => void;
}

const Rewards: React.FC<RewardsPageProps> = ({ pageAction, clearPageAction }) => {
  const dataCtx = useData() as ReturnType<typeof useData> & {
    getRewardsOrchestratorDeps?: () => import('../services/rewards/orchestrator').RewardsOrchestratorDeps | null;
  };
  const { data, showHydrateBanner } = dataCtx;
  const getDeps = () => dataCtx.getRewardsOrchestratorDeps?.() ?? null;
  const auth = useAuth();
  const { showToast: toast } = useToast();
  const { sarPerUsd } = useCanonicalFinancialMetrics();
  const canMutate = !isRestrictedRole(auth?.userRole);

  const accounts = data?.rewardsAccounts ?? [];
  const txs = data?.rewardsTransactions ?? [];
  const rewardsSar = sumRewardsFiatSar(data, sarPerUsd);
  const expiring = useMemo(
    () => rewardsExpiringWithinDays(accounts, txs, 30, new Date().toISOString().slice(0, 10), data?.rewardsLots),
    [accounts, txs, data?.rewardsLots],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [earnAccountId, setEarnAccountId] = useState<string | null>(null);
  const [redeemAccountId, setRedeemAccountId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string>(REWARDS_PROVIDER_TEMPLATES[0].key);
  const [providerName, setProviderName] = useState<string>(REWARDS_PROVIDER_TEMPLATES[0].providerName);
  const [earnAmount, setEarnAmount] = useState('');
  const [earnExpires, setEarnExpires] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemMode, setRedeemMode] = useState<'non_ledger' | 'statement_credit' | 'cash_deposit' | 'broker_deposit'>(
    'non_ledger',
  );
  const [targetAccountId, setTargetAccountId] = useState('');
  const [transferFromId, setTransferFromId] = useState<string | null>(null);
  const [transferToId, setTransferToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pageAction) return;
    if (pageAction === 'open-earn' || pageAction.startsWith('open-earn:')) {
      const id = pageAction.includes(':') ? pageAction.split(':')[1] : accounts[0]?.id;
      if (id) setEarnAccountId(id);
      return scheduleClearPageAction(clearPageAction);
    }
    if (pageAction === 'open-redeem' || pageAction.startsWith('open-redeem:')) {
      const id = pageAction.includes(':') ? pageAction.split(':')[1] : accounts[0]?.id;
      if (id) setRedeemAccountId(id);
      return scheduleClearPageAction(clearPageAction);
    }
    if (pageAction === 'open-rewards-expire' || pageAction.startsWith('open-rewards-expire')) {
      toast(
        expiring.length
          ? `${expiring.length} earn lot(s) expire within 30 days.`
          : 'No rewards expiring within 30 days.',
        'info',
      );
      return scheduleClearPageAction(clearPageAction);
    }
    if (pageAction === 'open-create-reward') {
      setShowCreate(true);
      return scheduleClearPageAction(clearPageAction);
    }
    scheduleClearPageAction(clearPageAction);
  }, [pageAction, accounts, clearPageAction, expiring.length, toast]);

  const handleCreate = async () => {
    if (!canMutate) return toast('Restricted role cannot mutate rewards.', 'error');
    const d = getDeps();
    if (!d) return toast('Not logged in', 'error');
    setBusy(true);
    try {
      const tpl = REWARDS_PROVIDER_TEMPLATES.find((t) => t.key === templateKey) ?? REWARDS_PROVIDER_TEMPLATES[0];
      const res = await createRewardsAccount(d, {
        providerName: providerName.trim() || tpl.providerName,
        rewardType: tpl.rewardType,
        unitLabel: tpl.unitLabel,
        fiatCurrency: 'SAR',
        pointsPerFiatUnit: tpl.pointsPerFiatUnit,
        templateKey: tpl.key,
        currentBalance: 0,
      });
      if (!res.ok) return toast(res.error ?? 'Failed', 'error');
      toast('Rewards account created', 'success');
      setShowCreate(false);
    } finally {
      setBusy(false);
    }
  };

  const handleEarn = async () => {
    if (!canMutate || !earnAccountId) return;
    const d = getDeps();
    if (!d) return toast('Not logged in', 'error');
    const amount = Number(earnAmount);
    if (!(amount > 0)) return toast('Enter a positive amount', 'error');
    setBusy(true);
    try {
      const res = await postRewardsLedgerEvent(d, {
        accountId: earnAccountId,
        transactionType: 'earn',
        amount,
        expiresOn: earnExpires || null,
        idempotencyKey: `earn|${earnAccountId}|${amount}|${earnExpires || 'none'}|${Date.now()}`,
        reason: 'Manual earn',
      });
      if (!res.ok) return toast(res.error ?? 'Earn failed', 'error');
      toast('Points earned', 'success');
      setEarnAccountId(null);
      setEarnAmount('');
    } finally {
      setBusy(false);
    }
  };

  const handleRedeem = async () => {
    if (!canMutate || !redeemAccountId) return;
    const d = getDeps();
    if (!d) return toast('Not logged in', 'error');
    const amount = Number(redeemAmount);
    if (!(amount > 0)) return toast('Enter a positive amount', 'error');
    let target: RewardsRedeemTarget = { kind: 'non_ledger', note: 'Travel/merchandise' };
    if (redeemMode === 'statement_credit') {
      if (!targetAccountId) return toast('Pick the credit card account', 'error');
      target = { kind: 'statement_credit', accountId: targetAccountId };
    } else if (redeemMode === 'cash_deposit') {
      if (!targetAccountId) return toast('Pick a cash account', 'error');
      target = { kind: 'cash_deposit', accountId: targetAccountId };
    } else if (redeemMode === 'broker_deposit') {
      if (!targetAccountId) return toast('Pick an investment account', 'error');
      target = { kind: 'broker_deposit', accountId: targetAccountId };
    }
    setBusy(true);
    try {
      const res = await redeemRewards(d, {
        accountId: redeemAccountId,
        amount,
        target,
        idempotencyKey: `redeem|${redeemAccountId}|${amount}|${redeemMode}|${Date.now()}`,
        reason: 'User redeem',
      });
      if (!res.ok) return toast(res.error ?? 'Redeem failed', 'error');
      toast('Redeemed', 'success');
      setRedeemAccountId(null);
      setRedeemAmount('');
    } finally {
      setBusy(false);
    }
  };

  const handleTransfer = async () => {
    if (!canMutate || !transferFromId) return;
    const d = getDeps();
    if (!d) return toast('Not logged in', 'error');
    const amount = Number(transferAmount);
    if (!(amount > 0)) return toast('Enter a positive amount', 'error');
    if (!transferToId || transferToId === transferFromId) {
      return toast('Pick a different destination rewards account', 'error');
    }
    setBusy(true);
    try {
      const res = await transferRewards(d, {
        fromAccountId: transferFromId,
        toAccountId: transferToId,
        amount,
        idempotencyKey: `xfer|${transferFromId}|${transferToId}|${amount}|${Date.now()}`,
        reason: 'User transfer between rewards accounts',
      });
      if (!res.ok) return toast(res.error ?? 'Transfer failed', 'error');
      toast('Transferred', 'success');
      setTransferFromId(null);
      setTransferToId('');
      setTransferAmount('');
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async (rewardTxId: string) => {
    if (!canMutate) return;
    const d = getDeps();
    if (!d) return toast('Not logged in', 'error');
    setBusy(true);
    try {
      const res = await reverseRewardsRedemption(d, { rewardTxId, reason: 'User undo' });
      if (!res.ok) return toast(res.error ?? 'Reverse failed', 'error');
      toast('Redemption reversed — points restored and ledger leg removed', 'success');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-dark">Rewards</h1>
          <p className="text-sm text-slate-500 mt-1">
            Points, miles, and cashback — manual balances only (no live loyalty APIs). Cashback to a card is a
            liability reduction, never Income. Estimated value{' '}
            {rewardsSar.toLocaleString(undefined, { maximumFractionDigits: 0 })} SAR (memo; excluded from emergency
            fund &amp; Zakat until redeemed).
            {showHydrateBanner ? ' Loading…' : ''}
          </p>
        </div>
        {canMutate && (
          <button
            type="button"
            className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm"
            onClick={() => setShowCreate(true)}
          >
            Add rewards account
          </button>
        )}
      </div>

      {expiring.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{expiring.length}</strong> earn lot(s) expire within 30 days:{' '}
          {expiring
            .slice(0, 5)
            .map((e) => `${e.providerName} (${e.expiresOn})`)
            .join(', ')}
          {expiring.length > 5 ? '…' : ''}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts
          .filter((a) => !a.archived)
          .map((a: RewardsAccount) => {
            const fiat =
              a.rewardType === 'cash'
                ? a.currentBalance
                : fiatEquivalentFromPoints(a.currentBalance, a.pointsPerFiatUnit);
            return (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="font-medium text-dark">{a.providerName}</div>
                    <div className="text-xs text-slate-500 uppercase tracking-wide">{a.rewardType}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">
                      {a.currentBalance.toLocaleString()} {a.unitLabel}
                    </div>
                    <div className="text-xs text-slate-500">
                      ≈ {fiat.toLocaleString()} {a.fiatCurrency}
                    </div>
                  </div>
                </div>
                {canMutate && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs rounded border px-2 py-1"
                      onClick={() => setEarnAccountId(a.id)}
                    >
                      Earn
                    </button>
                    <button
                      type="button"
                      className="text-xs rounded border px-2 py-1"
                      onClick={() => {
                        setRedeemAccountId(a.id);
                        setTargetAccountId(a.linkedAccountId ?? '');
                      }}
                    >
                      Redeem
                    </button>
                    <button
                      type="button"
                      className="text-xs rounded border px-2 py-1"
                      onClick={() => {
                        setTransferFromId(a.id);
                        setTransferToId(accounts.find((x) => x.id !== a.id)?.id ?? '');
                      }}
                    >
                      Transfer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        {accounts.length === 0 && (
          <p className="text-slate-500 text-sm col-span-full">
            No rewards accounts yet. Add Qitaf, AlFursan, Mukafaat, or card cashback as a manual ledger.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b font-medium">Recent rewards activity</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Type</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Fiat</th>
                <th className="p-2">Status</th>
                <th className="p-2">Expires</th>
                <th className="p-2 text-right">Undo</th>
              </tr>
            </thead>
            <tbody>
              {txs.slice(0, 40).map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{t.effectiveDate}</td>
                  <td className="p-2">{t.transactionType}</td>
                  <td className="p-2">{t.amount}</td>
                  <td className="p-2">{t.fiatEquivalent}</td>
                  <td className="p-2">{t.status}</td>
                  <td className="p-2">{t.expiresOn ?? '—'}</td>
                  <td className="p-2 text-right">
                    {canMutate && t.transactionType === 'redeem' && t.status !== 'reversed' ? (
                      <button
                        type="button"
                        onClick={() => handleReverse(t.id)}
                        disabled={busy}
                        className="text-xs font-medium text-rose-700 hover:text-rose-800 disabled:opacity-50"
                        title="Reverse this redemption: removes the cash or broker leg, restores the card balance, and credits the points back."
                      >
                        Reverse
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {txs.length === 0 && (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={7}>
                    No rewards transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3">
            <h2 className="font-semibold text-lg">Add rewards account</h2>
            <label className="block text-sm">
              Template
              <select
                className="mt-1 w-full border rounded px-2 py-1.5"
                value={templateKey}
                onChange={(e) => {
                  setTemplateKey(e.target.value);
                  const tpl = REWARDS_PROVIDER_TEMPLATES.find((t) => t.key === e.target.value);
                  if (tpl) setProviderName(tpl.providerName);
                }}
              >
                {REWARDS_PROVIDER_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.providerName} ({t.rewardType})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Display name
              <input
                className="mt-1 w-full border rounded px-2 py-1.5"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-1.5 text-sm" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded bg-emerald-700 text-white"
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {earnAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3">
            <h2 className="font-semibold text-lg">Earn</h2>
            <input
              type="number"
              className="w-full border rounded px-2 py-1.5"
              placeholder="Amount"
              value={earnAmount}
              onChange={(e) => setEarnAmount(e.target.value)}
            />
            <label className="block text-xs text-slate-500">
              Expires on (optional)
              <input
                type="date"
                className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                value={earnExpires}
                onChange={(e) => setEarnExpires(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEarnAccountId(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded bg-emerald-700 text-white px-3 py-1.5"
                onClick={handleEarn}
              >
                Post earn
              </button>
            </div>
          </div>
        </div>
      )}

      {redeemAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3">
            <h2 className="font-semibold text-lg">Redeem</h2>
            <input
              type="number"
              className="w-full border rounded px-2 py-1.5"
              placeholder="Amount"
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(e.target.value)}
            />
            <select
              className="w-full border rounded px-2 py-1.5"
              value={redeemMode}
              onChange={(e) => setRedeemMode(e.target.value as typeof redeemMode)}
            >
              <option value="non_ledger">Travel / merchandise (non-ledger)</option>
              <option value="statement_credit">Statement credit (CC liability ↓)</option>
              <option value="cash_deposit">Cash deposit</option>
              <option value="broker_deposit">Broker deposit (fiat cost basis)</option>
            </select>
            {redeemMode !== 'non_ledger' && (
              <select
                className="w-full border rounded px-2 py-1.5"
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
              >
                <option value="">Select account…</option>
                {(data?.accounts ?? [])
                  .filter((a) =>
                    redeemMode === 'broker_deposit'
                      ? a.type === 'Investment'
                      : redeemMode === 'statement_credit'
                        ? a.type === 'Credit'
                        : a.type === 'Checking' || a.type === 'Savings',
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRedeemAccountId(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded bg-emerald-700 text-white px-3 py-1.5"
                onClick={handleRedeem}
              >
                Redeem
              </button>
            </div>
          </div>
        </div>
      )}

      {transferFromId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3">
            <h2 className="font-semibold text-lg">Transfer between rewards accounts</h2>
            <p className="text-xs text-slate-500">
              Moves points/cashback balance only — no cash ledger posting. Destination must be another rewards account.
            </p>
            <input
              type="number"
              className="w-full border rounded px-2 py-1.5"
              placeholder="Amount"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
            />
            <select
              className="w-full border rounded px-2 py-1.5"
              value={transferToId}
              onChange={(e) => setTransferToId(e.target.value)}
            >
              <option value="">Select destination…</option>
              {accounts
                .filter((a) => a.id !== transferFromId && !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.providerName} ({a.currentBalance.toLocaleString()} {a.unitLabel})
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTransferFromId(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded bg-slate-800 text-white px-3 py-1.5"
                onClick={handleTransfer}
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Rewards;
