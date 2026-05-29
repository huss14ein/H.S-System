import React, { useContext } from 'react';
import { DataContext } from '../context/DataContext';

/**
 * Thin top-of-page indicator while the first Supabase hydrate runs.
 * Pages stay mounted underneath — never replaces the whole route with a spinner.
 */
const FinancialDataHydrateBanner: React.FC = () => {
  const { showHydrateBanner } = useContext(DataContext)!;
  if (!showHydrateBanner) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-slate-700"
    >
      <span
        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden
      />
      <span>Syncing your financial data…</span>
    </div>
  );
};

export default FinancialDataHydrateBanner;
