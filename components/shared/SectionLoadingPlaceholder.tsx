import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

/** Accessible loading shell for deferred sections — never aria-hidden. */
export const SectionLoadingPlaceholder: React.FC<{
  labelKey?: string;
  label?: string;
  minHeight?: string;
  className?: string;
  compact?: boolean;
}> = ({ labelKey = 'sectionLoading', label, minHeight = '10rem', className = '', compact = false }) => {
  const { t } = useLanguage();
  const message = label ?? t(labelKey);
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-slate-50/80 flex flex-col items-center justify-center gap-2 ${compact ? 'px-3 py-4' : 'px-4 py-6'} ${className}`}
      style={{ minHeight: compact ? undefined : minHeight }}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className={`rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin ${compact ? 'h-5 w-5' : 'h-8 w-8'}`}
        aria-hidden
      />
      <p className={`text-slate-600 text-center max-w-md ${compact ? 'text-xs' : 'text-sm'}`}>{message}</p>
    </div>
  );
};

export default SectionLoadingPlaceholder;
