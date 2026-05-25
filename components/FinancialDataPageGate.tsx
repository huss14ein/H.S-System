import React, { useContext } from 'react';
import { DataContext } from '../context/DataContext';
import PageLoading from './PageLoading';

/**
 * @deprecated Prefer Layout's FinancialDataHydrateBanner — pages should always render.
 * Kept for rare blocking flows; default variant is non-blocking banner.
 */
const FinancialDataPageGate: React.FC<{
  ariaLabel: string;
  message?: string;
  variant?: 'banner' | 'blocking';
  children: React.ReactNode;
}> = ({ ariaLabel, message, variant = 'banner', children }) => {
  const { showHydrateBanner } = useContext(DataContext)!;
  if (!showHydrateBanner) return <>{children}</>;
  if (variant === 'blocking') {
    return <PageLoading ariaLabel={ariaLabel} message={message} />;
  }
  return (
    <>
      <div role="status" aria-live="polite" className="mb-4 text-sm text-slate-600">
        {message ?? 'Syncing your financial data…'}
      </div>
      {children}
    </>
  );
};

export default FinancialDataPageGate;
