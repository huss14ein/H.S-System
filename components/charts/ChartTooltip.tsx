import React, { ReactNode } from 'react';
import { CHART_TOOLTIP_CLASS } from './chartTheme';

interface ChartTooltipProps {
  /** Title line (e.g. category or date) */
  title?: string;
  /** List of { label, value } or custom content */
  items?: { label: string; value: string | number }[];
  /** Optional footer (e.g. percentage) */
  footer?: ReactNode;
  /** Raw content instead of items */
  children?: ReactNode;
}

/**
 * Consistent tooltip styling for all charts.
 * Use inside Recharts Tooltip content prop or as standalone.
 */
const ChartTooltip: React.FC<ChartTooltipProps> = ({ title, items, footer, children }) => {
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      {title && <p className="font-semibold text-slate-800 mb-1 break-words">{title}</p>}
      {items && items.length > 0 && (
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span className="text-slate-600">{item.label}</span>
              <span className="font-medium text-slate-900 tabular-nums">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
      {footer && <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-slate-500 text-xs">{footer}</div>}
    </div>
  );
};

export default ChartTooltip;
