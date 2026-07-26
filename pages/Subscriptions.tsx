import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../services/supabaseClient';
import { isRestrictedRole } from '../utils/role';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { Page, SubscriptionRecord } from '../types';

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const CADENCES: SubscriptionRecord['cadence'][] = ['monthly', 'yearly', 'weekly'];

function monthlyEquivalent(amount: number, cadence: SubscriptionRecord['cadence']): number {
  const a = Number(amount) || 0;
  if (cadence === 'yearly') return a / 12;
  if (cadence === 'weekly') return a * (52 / 12);
  return a;
}

const Subscriptions: React.FC<{ setActivePage?: (page: Page) => void }> = () => {
  const { data, applyFinancialDataPatch } = useData();
  const auth = useAuth();
  const { showToast: toast } = useToast();
  const { formatCurrencyString } = useFormatCurrency();
  const canMutate = !isRestrictedRole(auth?.userRole);
  const subs = data?.subscriptions ?? [];

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<SubscriptionRecord['cadence']>('monthly');
  const [busy, setBusy] = useState(false);

  const monthlyTotal = useMemo(
    () => subs.filter((s) => s.status === 'active').reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.cadence), 0),
    [subs],
  );

  const addSub = async () => {
    if (!canMutate || !name.trim()) return toast('Name is required', 'error');
    const amt = Math.max(0, parseFloat(amount) || 0);
    if (!(amt > 0)) return toast('Enter a positive amount', 'error');
    const userId = auth?.user?.id;
    const sub: SubscriptionRecord = {
      id: newId(),
      name: name.trim(),
      amount: amt,
      currency: 'SAR',
      cadence,
      status: 'active',
    };
    setBusy(true);
    try {
      if (supabase && userId) {
        const { error } = await supabase.from('subscriptions').insert({
          id: sub.id,
          user_id: userId,
          name: sub.name,
          amount: sub.amount,
          currency: sub.currency,
          cadence: sub.cadence,
          status: sub.status,
        });
        if (error && error.code !== 'PGRST205') toast(`Could not save: ${error.message}`, 'error');
      }
      applyFinancialDataPatch((prev) => ({ ...prev, subscriptions: [sub, ...(prev.subscriptions ?? [])] }));
      setName('');
      setAmount('');
      toast('Subscription added', 'success');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (sub: SubscriptionRecord, status: SubscriptionRecord['status']) => {
    if (!canMutate) return;
    const userId = auth?.user?.id;
    if (supabase && userId) {
      await supabase.from('subscriptions').update({ status }).match({ id: sub.id, user_id: userId });
    }
    applyFinancialDataPatch((prev) => ({
      ...prev,
      subscriptions: (prev.subscriptions ?? []).map((s) => (s.id === sub.id ? { ...s, status } : s)),
    }));
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-dark">Subscriptions</h1>
          <p className="text-sm text-slate-500 mt-1">Recurring services — track cadence, price, and status.</p>
        </div>
        <div className="text-sm text-slate-500">
          Active monthly cost <span className="font-semibold text-dark">{formatCurrencyString(monthlyTotal, { digits: 0 })}</span>
        </div>
      </div>

      {canMutate && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-3 md:grid-cols-4">
          <input className="border rounded px-2 py-1.5 text-sm md:col-span-2" placeholder="Service name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" min="0" className="border rounded px-2 py-1.5 text-sm" placeholder="Amount (SAR)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="border rounded px-2 py-1.5 text-sm" value={cadence} onChange={(e) => setCadence(e.target.value as SubscriptionRecord['cadence'])}>
            {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" disabled={busy} className="btn-primary md:col-span-4 disabled:opacity-50" onClick={addSub}>Add subscription</button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-2">Service</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Cadence</th>
              <th className="p-2">Monthly eq.</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2 font-medium">{s.name}</td>
                <td className="p-2">{formatCurrencyString(s.amount, { digits: 0 })} {s.currency}</td>
                <td className="p-2 text-slate-500">{s.cadence}</td>
                <td className="p-2">{formatCurrencyString(monthlyEquivalent(s.amount, s.cadence), { digits: 0 })}</td>
                <td className="p-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{s.status}</span>
                </td>
                <td className="p-2 text-right space-x-2">
                  {canMutate && s.status !== 'active' && (
                    <button type="button" className="text-xs text-secondary" onClick={() => setStatus(s, 'active')}>Activate</button>
                  )}
                  {canMutate && s.status === 'active' && (
                    <button type="button" className="text-xs text-amber-700" onClick={() => setStatus(s, 'paused')}>Pause</button>
                  )}
                  {canMutate && s.status !== 'cancelled' && (
                    <button type="button" className="text-xs text-red-600" onClick={() => setStatus(s, 'cancelled')}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
            {subs.length === 0 && (
              <tr><td className="p-3 text-slate-500" colSpan={6}>No subscriptions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Subscriptions;
