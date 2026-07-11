import React from 'react';
import { useAnalyticsWorkspace } from '../../context/AnalyticsWorkspaceContext';

const TABS: { id: 'explore' | 'command' | 'position'; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'command', label: 'Command center' },
  { id: 'position', label: 'Position' },
];

export const AnalysisStudioTabs: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { analysisStudioTab, setAnalysisStudioTab } = useAnalyticsWorkspace();

  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="tablist" aria-label="Analysis studio">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={analysisStudioTab === tab.id}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            analysisStudioTab === tab.id
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
          onClick={() => setAnalysisStudioTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default AnalysisStudioTabs;
