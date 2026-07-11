import React, { useEffect } from 'react';
import type { PortfolioPeriodPnLBreakdown } from '../../services/portfolioPeriodPnL';

type Props = {
  portfolioName: string;
  period: 'weekly' | 'monthly';
  breakdown: PortfolioPeriodPnLBreakdown;
  formatCurrency: (n: number) => string;
  onClose: () => void;
  onOpenInvestments?: () => void;
};

export const PortfolioPeriodPnLBreakdownDrawer: React.FC<Props> = ({
  portfolioName,
  period,
  breakdown,
  formatCurrency,
  onClose,
  onOpenInvestments,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const periodLabel = period === 'weekly' ? 'Week' : 'Financial month';
  const rows = [
    { label: 'Ledger (realized + income − fees)', value: breakdown.ledgerSar },
    { label: 'Market estimate (price change)', value: breakdown.marketEstimateSar },
    { label: 'Total P/L', value: breakdown.totalSar, bold: true },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`${portfolioName} ${periodLabel} P/L breakdown`}>
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white shadow-2xl flex flex-col max-h-full">
        <header className="border-b border-slate-200 px-5 py-4">
          <p className="text-xs font-bold uppercase text-slate-500">{periodLabel} P/L breakdown</p>
          <h2 className="text-xl font-bold text-slate-900">{portfolioName}</h2>
          <button type="button" className="absolute top-4 end-5 text-sm font-semibold text-slate-500 hover:text-slate-800" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {rows.map((r) => (
            <div
              key={r.label}
              className={`flex justify-between gap-3 rounded-lg border border-slate-100 px-4 py-3 ${r.bold ? 'bg-indigo-50/50 border-indigo-100' : ''}`}
            >
              <span className="text-sm text-slate-700">{r.label}</span>
              <span
                className={`text-sm tabular-nums font-semibold ${
                  Math.abs(r.value) < 0.5 ? 'text-slate-600' : r.value > 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {r.value >= 0 ? '+' : ''}
                {formatCurrency(r.value)}
              </span>
            </div>
          ))}
          <p className="text-xs text-slate-500 pt-2">
            Total = ledger + market estimate. Mark-to-market from period start; not the same as Dashboard monthly cashflow P/L.
          </p>
        </div>
        {onOpenInvestments ? (
          <footer className="border-t border-slate-200 px-5 py-4">
            <button type="button" className="btn-primary w-full text-sm" onClick={onOpenInvestments}>
              Open in Investments
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
};

export default PortfolioPeriodPnLBreakdownDrawer;
