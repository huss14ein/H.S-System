/**
 * Shared chart design tokens for consistent graphs across the app.
 * Use these in all recharts components: colors, grid, axes, tooltips.
 */

/** Categorical palette (allocation, pie, bar series) – use in order */
export const CHART_COLORS = {
  categorical: [
    '#4f46e5', // indigo-600
    '#0891b2', // cyan-600
    '#059669', // emerald-600
    '#d97706', // amber-600
    '#dc2626', // red-600
    '#7c3aed', // violet-600
    '#ea580c', // orange-600
    '#0d9488', // teal-600
  ],
  /** Income / positive / gain */
  positive: '#059669',
  /** Expenses / negative / loss */
  negative: '#dc2626',
  /** Primary (cash, main series) */
  primary: '#2563eb',
  /** Secondary (investments, second series) */
  secondary: '#7c3aed',
  /** Tertiary (property, assets) */
  tertiary: '#059669',
  /** Liabilities / debt */
  liability: '#dc2626',
  /** Neutral (grid, axis) */
  grid: '#e2e8f0',
  axis: '#64748b',
} as const;

/** Default Recharts margin for consistent spacing */
export const CHART_MARGIN = { top: 10, right: 20, left: 10, bottom: 5 };

/** CartesianGrid stroke – consistent dash */
export const CHART_GRID_STROKE = '3 3';
export const CHART_GRID_COLOR = CHART_COLORS.grid;

/** Axis tick font */
export const CHART_AXIS_FONT_SIZE = 12;
export const CHART_AXIS_COLOR = CHART_COLORS.axis;

/** Tooltip wrapper class – use for custom tooltips */
export const CHART_TOOLTIP_CLASS =
  'bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-sm min-w-[120px]';

/** Compact number formatter for Y-axis */
export function formatAxisNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
}
