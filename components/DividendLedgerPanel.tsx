import React, { useContext, useState } from 'react';
import { DataContext } from '../context/DataContext';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { ResolvedSymbolLabel } from './SymbolWithCompanyName';
import type { SymbolNamesMap } from './SymbolWithCompanyName';
import type { InvestmentTransaction } from '../types';
import Modal from './Modal';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';

const DividendLedgerPanel: React.FC<{
  transactions: InvestmentTransaction[];
  companyNames: SymbolNamesMap;
  formatTxAmountSar: (t: InvestmentTransaction) => string;
}> = ({ transactions, companyNames, formatTxAmountSar }) => {
  const { data, updateInvestmentTransaction, deleteInvestmentTransaction } = useContext(DataContext)!;
  const confirmAction = useConfirmAction();
  const [editing, setEditing] = useState<InvestmentTransaction | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const portfolios = data?.investments ?? [];

  const openEdit = (t: InvestmentTransaction) => {
    setEditing(t);
    setEditDate(String(t.date).slice(0, 10));
    const raw = Number(t.total) || 0;
    setEditAmount(raw > 0 ? String(raw) : '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const total = parseFloat(editAmount);
    if (!Number.isFinite(total) || total <= 0) return;
    const ok = await confirmAction({
      title: 'Save dividend changes?',
      message: 'Update this dividend in your investment ledger?',
      confirmLabel: 'Save changes',
      details: [
        `Symbol: ${editing.symbol}`,
        `Date: ${editDate}`,
        `Amount: ${total}`,
      ],
    });
    if (!ok) return;
    setBusy(true);
    try {
      const p = portfolios.find((x) => x.id === editing.portfolioId);
      const book = p ? resolveInvestmentPortfolioCurrency(p) : editing.currency === 'SAR' ? 'SAR' : 'USD';
      await updateInvestmentTransaction({
        ...editing,
        date: editDate,
        total,
        quantity: 0,
        price: 0,
        currency: book,
      }, { confirmed: true });
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const removeTx = async (t: InvestmentTransaction) => {
    const ok = await confirmAction({
      title: 'Delete dividend?',
      message: 'Remove this dividend from your ledger and reverse its cash impact on the platform?',
      confirmLabel: 'Delete',
      variant: 'danger',
      details: [
        `Symbol: ${t.symbol}`,
        `Date: ${new Date(t.date).toLocaleDateString()}`,
        `Amount: ${formatTxAmountSar(t)}`,
      ],
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteInvestmentTransaction(t.id, { confirmed: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section-card">
      <h3 className="section-title">Dividend ledger (edit / delete)</h3>
      <p className="text-sm text-slate-600 mb-3">
        Fix mistaken dividend rows here. Buys and sells are not editable from this panel.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">{new Date(t.date).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <ResolvedSymbolLabel symbol={t.symbol || ''} names={companyNames} layout="inline" />
                </td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-800">{formatTxAmountSar(t)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button type="button" className="text-xs font-semibold text-primary mr-2" disabled={busy} onClick={() => openEdit(t)}>
                    Edit
                  </button>
                  <button type="button" className="text-xs font-semibold text-rose-700" disabled={busy} onClick={() => void removeTx(t)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length === 0 && <p className="text-sm text-slate-500 py-4">No dividend transactions yet.</p>}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title="Edit dividend">
        {editing && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{editing.symbol}</p>
            <label className="block text-xs font-semibold text-slate-700">
              Payment date
              <input type="date" className="input-base w-full mt-1" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Cash amount (book currency)
              <input type="number" min={0} step="any" className="input-base w-full mt-1" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </label>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void saveEdit()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DividendLedgerPanel;
