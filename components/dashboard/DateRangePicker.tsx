import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { formatDashboardRangeLabel } from './chartLayout';

export type DashboardDateRangePreset = '1M' | '3M' | '6M' | '1Y' | 'All' | 'Custom';

export type DashboardDateRange = {
  preset: DashboardDateRangePreset;
  startIso?: string;
  endIso?: string;
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeForPreset(preset: DashboardDateRangePreset): { startIso?: string; endIso?: string } {
  if (preset === 'All') return {};
  const end = new Date();
  const start = new Date(end);
  if (preset === '1M') start.setDate(start.getDate() - 31);
  if (preset === '3M') start.setDate(start.getDate() - 93);
  if (preset === '6M') start.setDate(start.getDate() - 186);
  if (preset === '1Y') start.setDate(start.getDate() - 365);
  return { startIso: toIsoDate(start), endIso: toIsoDate(end) };
}

export function createDashboardDateRange(
  preset: Exclude<DashboardDateRangePreset, 'Custom'>,
): DashboardDateRange {
  return { preset, ...rangeForPreset(preset) };
}

/** Financial months to load for cashflow chart (buffer month on each side). */
export function dashboardSuiteMonthsBack(range: DashboardDateRange): number {
  if (range.preset === '1M') return 3;
  if (range.preset === '3M') return 5;
  if (range.preset === '6M') return 8;
  if (range.preset === '1Y') return 14;
  if (range.preset === 'All') return 24;
  if (range.startIso && range.endIso) {
    const [sy, sm] = range.startIso.slice(0, 7).split('-').map(Number);
    const [ey, em] = range.endIso.slice(0, 7).split('-').map(Number);
    const span = (ey - sy) * 12 + (em - sm) + 2;
    return Math.min(24, Math.max(3, span));
  }
  return 12;
}

function formatIsoRangeLabel(startIso?: string, endIso?: string, lang: 'en' | 'ar' = 'en'): string {
  if (!startIso && !endIso) {
    return lang === 'ar' ? 'كل السجل' : 'All history';
  }
  if (startIso && endIso) {
    const fmt = (iso: string) =>
      new Date(`${iso}T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    return `${fmt(startIso)} – ${fmt(endIso)}`;
  }
  return formatDashboardRangeLabel(startIso ?? '—', endIso ?? '—');
}

export const DateRangePicker: React.FC<{
  value: DashboardDateRange;
  onChange: (v: DashboardDateRange) => void;
  className?: string;
}> = ({ value, onChange, className = '' }) => {
  const { t, dir, language } = useLanguage();
  const [customStart, setCustomStart] = useState(value.startIso ?? '');
  const [customEnd, setCustomEnd] = useState(value.endIso ?? '');

  const presets = useMemo(
    () =>
      [
        { id: '1M' as const, label: '1M' },
        { id: '3M' as const, label: '3M' },
        { id: '6M' as const, label: '6M' },
        { id: '1Y' as const, label: '1Y' },
        { id: 'All' as const, label: t('apply') === 'تطبيق' ? 'الكل' : 'All' },
      ] as Array<{ id: Exclude<DashboardDateRangePreset, 'Custom'>; label: string }>,
    [t],
  );

  const activeRangeLabel = useMemo(() => {
    if (value.preset === 'Custom') {
      return formatIsoRangeLabel(value.startIso, value.endIso, language);
    }
    if (value.preset === 'All') {
      return formatIsoRangeLabel(undefined, undefined, language);
    }
    const r = rangeForPreset(value.preset);
    return formatIsoRangeLabel(r.startIso, r.endIso, language);
  }, [language, value]);

  return (
    <div dir={dir} className={`flex flex-col gap-2.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {t('dateRange')}
        </span>
        <span className="text-xs text-slate-600 tabular-nums">{activeRangeLabel}</span>
      </div>
      <div
        className="inline-flex w-full sm:w-auto flex-wrap gap-1 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80"
        role="group"
        aria-label={t('dateRange')}
      >
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                const r = rangeForPreset(p.id);
                onChange({ preset: p.id, ...r });
              }}
              className={`min-w-[2.5rem] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                value.preset === p.id
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange({ preset: 'Custom', startIso: value.startIso, endIso: value.endIso })}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              value.preset === 'Custom'
                ? 'bg-white text-violet-900 shadow-sm ring-1 ring-violet-200/80'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            {t('apply') === 'تطبيق' ? 'مخصص' : 'Custom'}
          </button>
      </div>

      {value.preset === 'Custom' && (
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-3 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t('apply') === 'تطبيق' ? 'من' : 'From'}
            </label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="mt-1 w-full input-base bg-white"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t('apply') === 'تطبيق' ? 'إلى' : 'To'}
            </label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="mt-1 w-full input-base bg-white"
            />
          </div>
          <button
            type="button"
            onClick={() => onChange({ preset: 'Custom', startIso: customStart || undefined, endIso: customEnd || undefined })}
            className="btn-primary w-full sm:w-auto shrink-0"
          >
            {t('apply')}
          </button>
        </div>
      )}
    </div>
  );
};
