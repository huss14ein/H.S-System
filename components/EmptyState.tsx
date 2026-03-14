import React, { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Short title (e.g. "No transactions yet") */
  title?: string;
  /** Optional longer description or hint */
  description?: ReactNode;
  /** Optional icon element (e.g. <DocumentDuplicateIcon className="h-12 w-12 text-slate-300" />) */
  icon?: ReactNode;
  /** Optional primary action (e.g. "Add transaction" button) */
  action?: ReactNode;
  /** Extra class for the wrapper */
  className?: string;
}

/**
 * Reusable empty state for lists, sections, and dashboards.
 * Aligns with .empty-state styling and light theme.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  className = '',
}) => (
  <div
    className={`empty-state flex flex-col items-center justify-center gap-3 text-center ${className}`}
    role="status"
    aria-label={title ?? 'No items'}
  >
    {icon && <div className="shrink-0" aria-hidden>{icon}</div>}
    {title && <p className="font-medium text-slate-600">{title}</p>}
    {description && (
      <div className="text-slate-500 text-sm max-w-sm">
        {typeof description === 'string' ? <p>{description}</p> : description}
      </div>
    )}
    {action && <div className="mt-1">{action}</div>}
  </div>
);

export default EmptyState;
