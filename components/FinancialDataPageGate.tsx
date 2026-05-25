import React, { useContext } from 'react';
import { DataContext } from '../context/DataContext';
import PageLoading from './PageLoading';

/**
 * Wraps page content so the first Supabase hydrate shows a shared spinner,
 * while background refetches keep the page visible (DataContext.showBlockingLoader).
 */
const FinancialDataPageGate: React.FC<{
  ariaLabel: string;
  message?: string;
  children: React.ReactNode;
}> = ({ ariaLabel, message, children }) => {
  const { showBlockingLoader } = useContext(DataContext)!;
  if (showBlockingLoader) {
    return <PageLoading ariaLabel={ariaLabel} message={message} />;
  }
  return <>{children}</>;
};

export default FinancialDataPageGate;
