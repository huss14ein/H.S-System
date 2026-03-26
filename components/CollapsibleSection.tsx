import React, { ReactNode, useState } from 'react';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';

interface CollapsibleSectionProps {
  /** Section title (always visible) */
  title: string;
  /** Optional one-line summary when collapsed */
  summary?: string;
  /** Content shown when expanded */
  children: ReactNode;
  /** Kept for API compatibility; sections always mount expanded (click header to collapse). */
  defaultExpanded?: boolean;
  /** Extra class for the container */
  className?: string;
  /** Optional icon before title */
  icon?: ReactNode;
  /** Use section-card styling */
  card?: boolean;
}

/**
 * Collapsible section: title + optional summary when collapsed; full content when expanded.
 * Use for methodology, guidance, stress tests, and other dense content to keep pages clean.
 */
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  summary,
  children,
  defaultExpanded: _defaultExpanded,
  className = '',
  icon,
  card = true,
}) => {
  const [expanded, setExpanded] = useState(_defaultExpanded ?? true);

  const baseClass = card ? 'section-card' : 'rounded-lg border border-slate-200 bg-white';
  const headerClass = 'flex items-center justify-between gap-3 w-full text-left py-1 pr-1 cursor-pointer hover:bg-slate-50/80 rounded-lg transition-colors';

  return (
    <div className={`${baseClass} ${className}`}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={headerClass}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon}
          {/* Use explicit `mb-0` instead of global `.section-title` margin to keep header rows aligned. */}
          <h3 className="mb-0 text-base font-semibold text-slate-800 truncate">{title}</h3>
          {summary && !expanded && (
            <span className="hidden sm:inline text-sm text-slate-500 truncate ml-1">— {summary}</span>
          )}
        </div>
        <span className="flex-shrink-0 p-1 rounded text-slate-400 hover:text-slate-600" aria-hidden>
          {expanded ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
        </span>
      </button>
      {expanded && <div className="pt-3 mt-1 border-t border-slate-100">{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
