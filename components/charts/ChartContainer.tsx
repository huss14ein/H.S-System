import React, { ReactNode } from 'react';

interface ChartContainerProps {
  children: ReactNode;
  /** Minimum height for the chart area (e.g. "300px", "100%") */
  height?: string | number;
  /** Show when data is empty or missing */
  emptyMessage?: string;
  /** Whether the chart has no data to display */
  isEmpty?: boolean;
  /** Optional class for the wrapper */
  className?: string;
}

/**
 * Wraps chart content with consistent height and empty state.
 * Use around ResponsiveContainer (or chart + ResponsiveContainer) for consistent layout.
 */
const ChartContainer: React.FC<ChartContainerProps> = ({
  children,
  height = '100%',
  emptyMessage = 'No data to display.',
  isEmpty = false,
  className = '',
}) => {
  const style = typeof height === 'number' ? { minHeight: height } : { minHeight: height };

  if (isEmpty) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 text-sm ${className}`}
        style={style}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`chart-container ${className}`} style={style}>
      {children}
    </div>
  );
};

export default ChartContainer;
