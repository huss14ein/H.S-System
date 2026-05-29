import React from 'react';

type Accent = 'violet' | 'emerald' | 'sky' | 'amber' | 'rose';

const ACCENT: Record<Accent, string> = {
  violet: 'border-violet-200/70 bg-gradient-to-br from-violet-50/80 via-white to-white shadow-violet-100/40',
  emerald: 'border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 via-white to-white shadow-emerald-100/40',
  sky: 'border-sky-200/70 bg-gradient-to-br from-sky-50/80 via-white to-white shadow-sky-100/40',
  amber: 'border-amber-200/70 bg-gradient-to-br from-amber-50/80 via-white to-white shadow-amber-100/40',
  rose: 'border-rose-200/70 bg-gradient-to-br from-rose-50/80 via-white to-white shadow-rose-100/40',
};

export const DashboardVisualCard: React.FC<{
  title: string;
  subtitle?: string;
  accent?: Accent;
  action?: React.ReactNode;
  children: React.ReactNode;
  dir?: 'ltr' | 'rtl';
  className?: string;
}> = ({ title, subtitle, accent = 'violet', action, children, dir, className = '' }) => (
  <div
    dir={dir}
    className={`rounded-3xl border shadow-lg ${ACCENT[accent]} p-4 sm:p-5 ${className}`}
  >
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-slate-700">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);
