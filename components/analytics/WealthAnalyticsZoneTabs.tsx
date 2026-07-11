import React from 'react';
import { useAnalyticsWorkspace } from '../../context/AnalyticsWorkspaceContext';

const ZONES: { id: 'overview' | 'wealth' | 'investments' | 'cash'; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'wealth', label: 'Wealth' },
  { id: 'investments', label: 'Investments' },
  { id: 'cash', label: 'Cash & Spend' },
];

export const WealthAnalyticsZoneTabs: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { wealthZone, setWealthZone } = useAnalyticsWorkspace();
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="tablist" aria-label="Wealth analytics zones">
      {ZONES.map((z) => (
        <button
          key={z.id}
          type="button"
          role="tab"
          aria-selected={wealthZone === z.id}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            wealthZone === z.id
              ? 'bg-primary text-white shadow-sm'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
          onClick={() => setWealthZone(z.id)}
        >
          {z.label}
        </button>
      ))}
    </div>
  );
};

export default WealthAnalyticsZoneTabs;
