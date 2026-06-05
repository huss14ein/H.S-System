import React, { useContext } from 'react';
import { DataContext } from '../context/DataContext';

/** Surfaces partial Supabase hydrate issues app-wide (not only on Transactions). */
const DataLoadWarningBanner: React.FC = () => {
  const ctx = useContext(DataContext);
  const warning = ctx?.transactionsLoadWarning;
  const hydrating = ctx?.showHydrateBanner;
  if (!warning || hydrating) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="alert"
    >
      <p className="font-semibold">Some data did not finish loading</p>
      <p className="mt-1">{warning}</p>
      <p className="mt-1 text-xs opacity-90">
        Settings → refresh data, or hard-refresh the page. If this persists, check your network or Supabase project status.
      </p>
    </div>
  );
};

export default DataLoadWarningBanner;
