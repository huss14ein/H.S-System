import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

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

export const DateRangePicker: React.FC<{
  value: DashboardDateRange;
  onChange: (v: DashboardDateRange) => void;
}> = ({ value, onChange }) => {
  const { t, dir } = useLanguage();
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

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('dateRange')}</p>
          <p className="mt-0.5 text-sm text-slate-700">
            {value.preset === 'Custom'
              ? `${value.startIso ?? '—'} → ${value.endIso ?? '—'}`
              : value.preset}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                const r = rangeForPreset(p.id);
                onChange({ preset: p.id, ...r });
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                value.preset === p.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange({ preset: 'Custom', startIso: value.startIso, endIso: value.endIso })}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              value.preset === 'Custom'
                ? 'border-violet-500 bg-violet-50 text-violet-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t('apply') === 'تطبيق' ? 'مخصص' : 'Custom'}
          </button>
        </div>
      </div>

      {value.preset === 'Custom' && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600">{t('apply') === 'تطبيق' ? 'من' : 'From'}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="mt-1 w-full input-base"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600">{t('apply') === 'تطبيق' ? 'إلى' : 'To'}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="mt-1 w-full input-base"
            />
          </div>
          <button
            type="button"
            onClick={() => onChange({ preset: 'Custom', startIso: customStart || undefined, endIso: customEnd || undefined })}
            className="btn-primary sm:ml-2"
          >
            {t('apply')}
          </button>
        </div>
      )}
    </div>
  );
};

