import React from 'react';

export interface PageIntroProps {
  title: string;
  description: string;
  /** Optional: show a "New here?" tip below */
  tip?: string;
  className?: string;
}

/**
 * Friendly intro banner for pages. Use for non-financial users.
 */
const PageIntro: React.FC<PageIntroProps> = ({ title, description, tip, className = '' }) => (
  <div className={`rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 sm:p-5 ${className}`}>
    <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
    <p className="mt-1 text-sm text-slate-600 leading-relaxed">{description}</p>
    {tip && (
      <p className="mt-3 text-xs text-slate-500 flex items-start gap-2">
        <span className="shrink-0 mt-0.5">💡</span>
        <span>{tip}</span>
      </p>
    )}
  </div>
);

export default PageIntro;
