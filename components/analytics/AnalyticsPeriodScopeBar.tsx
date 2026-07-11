import React from 'react';
import { useAnalyticsWorkspace } from '../../context/AnalyticsWorkspaceContext';
import type { ExpenseAnalysisScope } from '../../services/expenseBudgetAnalysisModel';

export const AnalyticsPeriodScopeBar: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { periodPreset, scope, setPeriodPreset, setScope } = useAnalyticsWorkspace();

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(['MTD', '3M', '6M', '12M', 'YTD'] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`px-3 py-1 text-xs font-semibold rounded-md ${
              periodPreset === p ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setPeriodPreset(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            { id: 'personal' as ExpenseAnalysisScope, label: 'Personal' },
            { id: 'household' as ExpenseAnalysisScope, label: 'Household' },
          ] as const
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            className={`px-3 py-1 text-xs font-semibold rounded-md ${
              scope === s.id ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setScope(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-500">SAR · financial month · tx-dated FX</span>
    </div>
  );
};

export default AnalyticsPeriodScopeBar;
