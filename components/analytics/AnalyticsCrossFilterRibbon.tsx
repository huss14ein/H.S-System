import React from 'react';

type Props = {
  category: string;
  onClear: () => void;
  className?: string;
};

/** Highlights active cross-filter category (synced with Analysis explorer). */
export const AnalyticsCrossFilterRibbon: React.FC<Props> = ({ category, onClear, className = '' }) => (
  <div
    className={`flex flex-wrap items-center justify-between gap-2 text-sm text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 ${className}`}
    role="status"
  >
    <span>
      Cross-filter: <strong>{category}</strong> highlighted on spending charts (synced with Analysis).
    </span>
    <button type="button" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 shrink-0" onClick={onClear}>
      Clear
    </button>
  </div>
);

export default AnalyticsCrossFilterRibbon;
