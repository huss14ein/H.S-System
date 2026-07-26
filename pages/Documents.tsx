import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../services/supabaseClient';
import { isRestrictedRole } from '../utils/role';
import type { Page, VaultDocument } from '../types';

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const KINDS: VaultDocument['kind'][] = ['deed', 'contract', 'statement', 'other'];

const Documents: React.FC<{ setActivePage?: (page: Page) => void }> = () => {
  const { data, applyFinancialDataPatch } = useData();
  const auth = useAuth();
  const { showToast: toast } = useToast();
  const canMutate = !isRestrictedRole(auth?.userRole);
  const docs = data?.vaultDocuments ?? [];

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<VaultDocument['kind']>('other');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const addDoc = async () => {
    if (!canMutate || !title.trim()) return toast('Title is required', 'error');
    const userId = auth?.user?.id;
    const doc: VaultDocument = {
      id: newId(),
      title: title.trim(),
      kind,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      if (supabase && userId) {
        const { error } = await supabase.from('vault_documents').insert({
          id: doc.id,
          user_id: userId,
          title: doc.title,
          kind: doc.kind,
          notes: doc.notes ?? null,
        });
        if (error && error.code !== 'PGRST205') toast(`Could not save: ${error.message}`, 'error');
      }
      applyFinancialDataPatch((prev) => ({ ...prev, vaultDocuments: [doc, ...(prev.vaultDocuments ?? [])] }));
      setTitle('');
      setNotes('');
      toast('Document added', 'success');
    } finally {
      setBusy(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!canMutate) return;
    const userId = auth?.user?.id;
    if (supabase && userId) {
      await supabase.from('vault_documents').delete().match({ id, user_id: userId });
    }
    applyFinancialDataPatch((prev) => ({
      ...prev,
      vaultDocuments: (prev.vaultDocuments ?? []).filter((d) => d.id !== id),
    }));
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-dark">Document Vault</h1>
        <p className="text-sm text-slate-500 mt-1">
          Track deeds, contracts, and key statements. Metadata only — store the files securely elsewhere.
        </p>
      </div>

      {canMutate && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-3 md:grid-cols-4">
          <input className="border rounded px-2 py-1.5 text-sm md:col-span-2" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="border rounded px-2 py-1.5 text-sm" value={kind} onChange={(e) => setKind(e.target.value as VaultDocument['kind'])}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" disabled={busy} className="btn-primary disabled:opacity-50" onClick={addDoc}>Add</button>
          <input className="border rounded px-2 py-1.5 text-sm md:col-span-4" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-2">Title</th>
              <th className="p-2">Kind</th>
              <th className="p-2">Notes</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2 font-medium">{d.title}</td>
                <td className="p-2 text-slate-500">{d.kind}</td>
                <td className="p-2 text-slate-500">{d.notes ?? '—'}</td>
                <td className="p-2 text-right">
                  {canMutate && (
                    <button type="button" className="text-xs text-red-600" onClick={() => deleteDoc(d.id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr><td className="p-3 text-slate-500" colSpan={4}>No documents yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Documents;
