import React, { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Icon (e.g. Heroicon component) */
  icon?: ReactNode;
  /** Main heading */
  title: string;
  /** Supporting description */
  description?: string;
  /** Primary action button */
  action?: { label: string; onClick: () => void };
  /** Secondary action (e.g. link) */
  secondaryAction?: { label: string; onClick: () => void };
  /** Extra class for the container */
  className?: string;
}

/**
 * Consistent empty state for lists, tables, and sections.
 * Use when there is no data to display.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
}) => (
  <div
    className={`flex flex-col items-center justify-center py-12 px-6 text-center rounded-xl border border-slate-200 bg-slate-50/50 ${className}`}
    role="status"
    aria-label={`${title}${description ? `. ${description}` : ''}`}
  >
    {icon && (
      <div className="mb-4 text-slate-300 [&>svg]:w-12 [&>svg]:h-12" aria-hidden>
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-slate-700">{title}</h3>
    {description && <p className="mt-1 text-sm text-slate-500 max-w-sm">{description}</p>}
    {(action || secondaryAction) && (
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            {action.label}
          </button>
        )}
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary border border-primary/40 rounded-xl hover:bg-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    )}
  </div>
);

export default EmptyState;
