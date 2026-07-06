import React, { useState } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  footnote?: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
};

/** Shared tooltip + click + cross-filter wrapper for analytics charts. */
export const InteractiveChartShell: React.FC<Props> = ({
  title,
  subtitle,
  footnote,
  className = '',
  children,
  onClick,
  selected,
}) => {
  const [hover, setHover] = useState(false);
  const interactive = Boolean(onClick);

  return (
    <section
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${
        selected ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'
      } ${interactive ? 'cursor-pointer hover:border-slate-300' : ''} ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </header>
      {children}
      {(footnote || hover) && footnote && (
        <p className="text-[10px] text-slate-400 mt-2 border-t border-slate-100 pt-2">{footnote}</p>
      )}
    </section>
  );
};

export default InteractiveChartShell;
