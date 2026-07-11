import React, { useEffect } from 'react';
import type { BudgetCategorySlideOverModel } from '../../services/budgetCategorySlideOverModel';

type Props = {
  model: BudgetCategorySlideOverModel;
  formatCurrency: (n: number) => string;
  onClose: () => void;
  onViewAll: () => void;
};

export const BudgetCategorySlideOver: React.FC<Props> = ({ model, formatCurrency, onClose, onViewAll }) => {
  const maxSpark = Math.max(...model.momSparkline.map((p) => p.spentSar), 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${model.category} budget detail`}>
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white shadow-2xl flex flex-col max-h-full animate-in slide-in-from-right">
        <header className="border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Budget category</p>
            <h2 className="text-xl font-bold text-slate-900">{model.category}</h2>
            <p className="text-sm text-slate-600 mt-1 tabular-nums">
              {formatCurrency(model.totalSpentSar)} this period
            </p>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800 text-sm font-semibold" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-bold uppercase text-slate-500 mb-2">6-month pace (SAR)</p>
          <div className="flex items-end gap-1 h-16" aria-hidden>
            {model.momSparkline.map((p) => (
              <div key={p.monthKey} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-indigo-500/80 min-h-[2px]"
                  style={{ height: `${Math.max(4, (p.spentSar / maxSpark) * 100)}%` }}
                  title={`${p.monthKey}: ${formatCurrency(p.spentSar)}`}
                />
                <span className="text-[9px] text-slate-400">{p.monthKey.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Recent transactions (last 20)</p>
          {model.transactions.length === 0 ? (
            <p className="text-sm text-slate-500">No approved expenses in this period.</p>
          ) : (
            <ul className="space-y-2">
              {model.transactions.map((tx) => (
                <li key={tx.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-slate-900 truncate">{tx.description}</span>
                    <span className="tabular-nums text-rose-700 shrink-0">{formatCurrency(tx.amountSar)}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {tx.date} · {tx.accountName}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 px-5 py-4">
          <button type="button" className="btn-primary w-full text-sm" onClick={onViewAll}>
            View all in Transactions
          </button>
        </footer>
      </aside>
    </div>
  );
};

export default BudgetCategorySlideOver;
