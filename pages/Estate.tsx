import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../services/supabaseClient';
import { isRestrictedRole } from '../utils/role';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { EstateBeneficiary, Page, PensionAccount } from '../types';

function newId(prefix: string): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const PENSION_KINDS: PensionAccount['kind'][] = ['gosi', 'provident', 'pension', 'other'];

const Estate: React.FC<{ setActivePage?: (page: Page) => void }> = () => {
  const { data, applyFinancialDataPatch } = useData();
  const auth = useAuth();
  const { showToast: toast } = useToast();
  const { formatCurrencyString } = useFormatCurrency();
  const canMutate = !isRestrictedRole(auth?.userRole);
  const beneficiaries = data?.estateBeneficiaries ?? [];
  const pensions = data?.pensionAccounts ?? [];

  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [share, setShare] = useState('');
  const [pName, setPName] = useState('');
  const [pKind, setPKind] = useState<PensionAccount['kind']>('gosi');
  const [pBalance, setPBalance] = useState('');
  const [busy, setBusy] = useState(false);

  const totalShare = useMemo(
    () => beneficiaries.reduce((s, b) => s + (Number(b.sharePercent) || 0), 0),
    [beneficiaries],
  );
  const totalPension = useMemo(
    () => pensions.reduce((s, p) => s + (Number(p.balance) || 0), 0),
    [pensions],
  );

  const addBeneficiary = async () => {
    if (!canMutate || !name.trim()) return toast('Name is required', 'error');
    const userId = auth?.user?.id;
    const b: EstateBeneficiary = {
      id: newId('ben'),
      name: name.trim(),
      relationship: relationship.trim() || undefined,
      sharePercent: Math.max(0, parseFloat(share) || 0) || undefined,
    };
    setBusy(true);
    try {
      if (supabase && userId) {
        const { error } = await supabase.from('estate_beneficiaries').insert({
          id: b.id,
          user_id: userId,
          name: b.name,
          relationship: b.relationship ?? null,
          share_percent: b.sharePercent ?? null,
        });
        if (error && error.code !== 'PGRST205') toast(`Could not save: ${error.message}`, 'error');
      }
      applyFinancialDataPatch((prev) => ({ ...prev, estateBeneficiaries: [b, ...(prev.estateBeneficiaries ?? [])] }));
      setName('');
      setRelationship('');
      setShare('');
      toast('Beneficiary added', 'success');
    } finally {
      setBusy(false);
    }
  };

  const deleteBeneficiary = async (id: string) => {
    if (!canMutate) return;
    const userId = auth?.user?.id;
    if (supabase && userId) await supabase.from('estate_beneficiaries').delete().match({ id, user_id: userId });
    applyFinancialDataPatch((prev) => ({
      ...prev,
      estateBeneficiaries: (prev.estateBeneficiaries ?? []).filter((b) => b.id !== id),
    }));
  };

  const addPension = async () => {
    if (!canMutate || !pName.trim()) return toast('Name is required', 'error');
    const userId = auth?.user?.id;
    const p: PensionAccount = {
      id: newId('pen'),
      name: pName.trim(),
      kind: pKind,
      balance: Math.max(0, parseFloat(pBalance) || 0),
      currency: 'SAR',
    };
    setBusy(true);
    try {
      if (supabase && userId) {
        const { error } = await supabase.from('pension_accounts').insert({
          id: p.id,
          user_id: userId,
          name: p.name,
          kind: p.kind,
          balance: p.balance,
          currency: p.currency,
        });
        if (error && error.code !== 'PGRST205') toast(`Could not save: ${error.message}`, 'error');
      }
      applyFinancialDataPatch((prev) => ({ ...prev, pensionAccounts: [p, ...(prev.pensionAccounts ?? [])] }));
      setPName('');
      setPBalance('');
      toast('Pension account added', 'success');
    } finally {
      setBusy(false);
    }
  };

  const deletePension = async (id: string) => {
    if (!canMutate) return;
    const userId = auth?.user?.id;
    if (supabase && userId) await supabase.from('pension_accounts').delete().match({ id, user_id: userId });
    applyFinancialDataPatch((prev) => ({
      ...prev,
      pensionAccounts: (prev.pensionAccounts ?? []).filter((p) => p.id !== id),
    }));
  };

  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-dark">Estate &amp; Pension</h1>
        <p className="text-sm text-slate-500 mt-1">
          Beneficiaries and GOSI / pension balances for estate planning. Informational — not legal advice.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-dark">Beneficiaries</h2>
          <div className="text-sm text-slate-500">
            Allocated <span className={`font-semibold ${totalShare > 100 ? 'text-red-600' : 'text-dark'}`}>{totalShare}%</span>
          </div>
        </div>
        {canMutate && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-3 md:grid-cols-4">
            <input className="border rounded px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="border rounded px-2 py-1.5 text-sm" placeholder="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
            <input type="number" min="0" max="100" className="border rounded px-2 py-1.5 text-sm" placeholder="Share %" value={share} onChange={(e) => setShare(e.target.value)} />
            <button type="button" disabled={busy} className="btn-primary disabled:opacity-50" onClick={addBeneficiary}>Add</button>
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="p-2">Name</th><th className="p-2">Relationship</th><th className="p-2">Share</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {beneficiaries.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-2 font-medium">{b.name}</td>
                  <td className="p-2 text-slate-500">{b.relationship ?? '—'}</td>
                  <td className="p-2">{b.sharePercent != null ? `${b.sharePercent}%` : '—'}</td>
                  <td className="p-2 text-right">{canMutate && <button type="button" className="text-xs text-red-600" onClick={() => deleteBeneficiary(b.id)}>Delete</button>}</td>
                </tr>
              ))}
              {beneficiaries.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={4}>No beneficiaries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-dark">Pension &amp; GOSI</h2>
          <div className="text-sm text-slate-500">
            Total <span className="font-semibold text-dark">{formatCurrencyString(totalPension, { digits: 0 })}</span>
          </div>
        </div>
        {canMutate && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-3 md:grid-cols-4">
            <input className="border rounded px-2 py-1.5 text-sm" placeholder="Account name" value={pName} onChange={(e) => setPName(e.target.value)} />
            <select className="border rounded px-2 py-1.5 text-sm" value={pKind} onChange={(e) => setPKind(e.target.value as PensionAccount['kind'])}>
              {PENSION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input type="number" min="0" className="border rounded px-2 py-1.5 text-sm" placeholder="Balance (SAR)" value={pBalance} onChange={(e) => setPBalance(e.target.value)} />
            <button type="button" disabled={busy} className="btn-primary disabled:opacity-50" onClick={addPension}>Add</button>
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="p-2">Account</th><th className="p-2">Kind</th><th className="p-2">Balance</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {pensions.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 font-medium">{p.name}</td>
                  <td className="p-2 text-slate-500 uppercase">{p.kind}</td>
                  <td className="p-2">{formatCurrencyString(p.balance, { digits: 0 })} {p.currency}</td>
                  <td className="p-2 text-right">{canMutate && <button type="button" className="text-xs text-red-600" onClick={() => deletePension(p.id)}>Delete</button>}</td>
                </tr>
              ))}
              {pensions.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={4}>No pension accounts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default Estate;
