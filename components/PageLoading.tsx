import React from 'react';

export interface PageLoadingProps {
  /** Accessible label for the loading indicator (e.g. "Loading dashboard") */
  ariaLabel: string;
  /** Optional short message shown below the spinner */
  message?: string;
  /** Minimum height so layout doesn't jump (default: 24rem) */
  minHeight?: string;
  /** Optional extra class for the wrapper */
  className?: string;
}

/**
 * Shared full-page or section loading UI with consistent spinner, aria-busy and aria-label.
 * Use when a page or section is loading (e.g. DataContext loading || !data).
 */
const PageLoading: React.FC<PageLoadingProps> = ({
  ariaLabel,
  message,
  minHeight = '24rem',
  className = '',
}) => (
  <div
    className={`flex flex-col justify-center items-center gap-3 ${className}`}
    style={{ minHeight }}
    aria-busy="true"
    aria-live="polite"
  >
    <div
      className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent"
      aria-label={ariaLabel}
      role="status"
    />
    {message && <p className="text-sm text-slate-600">{message}</p>}
  </div>
);

export default PageLoading;
