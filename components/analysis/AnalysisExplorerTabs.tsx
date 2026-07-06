import React from 'react';
import { useAnalyticsWorkspace } from '../../context/AnalyticsWorkspaceContext';

const TABS: { id: 'categories' | 'merchants' | 'cashflow' | 'position' | 'refunds'; label: string }[] = [
  { id: 'categories', label: 'Categories' },
  { id: 'merchants', label: 'Merchants' },
  { id: 'cashflow', label: 'Cashflow' },
  { id: 'position', label: 'Position' },
  { id: 'refunds', label: 'Refunds' },
];

export const AnalysisExplorerTabs: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { analysisExplorerTab, setAnalysisExplorerTab } = useAnalyticsWorkspace();
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="tablist" aria-label="Analysis explorer">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={analysisExplorerTab === tab.id}
          className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium ${
            analysisExplorerTab === tab.id
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
          onClick={() => setAnalysisExplorerTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default AnalysisExplorerTabs;
