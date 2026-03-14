import React, { useState, useEffect, useId } from 'react';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

export interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  summary?: React.ReactNode;
  storageKey?: string;
  className?: string;
  ariaId?: string;
}

const STORAGE_PREFIX = 'collapsible:';

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  children,
  defaultOpen = false,
  summary,
  storageKey,
  className = '',
  ariaId: propAriaId,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const generatedId = useId();
  const safeId = generatedId.replace(/:/g, '');
  const ariaId = propAriaId ?? `collapsible-panel-${safeId}`;
  const titleId = `collapsible-title-${safeId}`;

  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
        if (stored !== null) setOpen(stored === 'true');
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey && typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_PREFIX + storageKey, String(next));
      } catch {
        // ignore
      }
    }
  };

  return (
    <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${className}`}>
      <button
        type="button"
        id={titleId}
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={ariaId}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
      >
        <span className="section-title flex items-center gap-2 min-w-0">
          {title}
          {summary != null && <span className="text-sm font-normal text-slate-500 truncate">{summary}</span>}
        </span>
        <ChevronDownIcon className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div
        id={ariaId}
        role="region"
        aria-labelledby={titleId}
        className={open ? 'border-t border-slate-100' : 'hidden'}
      >
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
};

export default CollapsibleSection;
