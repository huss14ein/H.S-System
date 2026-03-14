/**
 * Demo Data Button Component
 * Reusable button for loading demo data across all pages
 */

import { loadDemoData } from '../services/demoDataService';

interface DemoDataButtonProps {
  page?: string;
  options?: {
    includeWealthUltra?: boolean;
    includeRecoveryPlan?: boolean;
    includeMarketEvents?: boolean;
    includeBudgets?: boolean;
    includeInvestments?: boolean;
    includeTransactions?: boolean;
    includeAccounts?: boolean;
    includeGoals?: boolean;
    includeAssets?: boolean;
    includeLiabilities?: boolean;
    includeAll?: boolean;
  };
  className?: string;
}

export const DemoDataButton: React.FC<DemoDataButtonProps> = ({ 
  page, 
  options = { includeAll: true },
  className = "text-xs px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
}) => {
  return (
    <button
      type="button"
      onClick={() => {
        loadDemoData(options);
        window.location.reload();
      }}
      className={className}
      title={`Load demo data for ${page || 'testing'}`}
    >
      Load Demo Data
    </button>
  );
};
