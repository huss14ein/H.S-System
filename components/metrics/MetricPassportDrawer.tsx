import React, { useEffect } from 'react';
import type { MetricPassportModel } from '../../services/metricPassportModel';

type Props = {
  model: MetricPassportModel;
  onClose: () => void;
};

export const MetricPassportDrawer: React.FC<Props> = ({ model, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`${model.title} metric passport`}>
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white shadow-2xl flex flex-col max-h-full">
        <header className="border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-indigo-600">Metric passport</p>
            <h2 className="text-xl font-bold text-slate-900 truncate">{model.title}</h2>
            <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{model.valueDisplay}</p>
            {model.statusLabel ? (
              <p className="text-xs font-semibold text-slate-600 mt-1">{model.statusLabel}</p>
            ) : null}
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800 text-sm font-semibold shrink-0" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {model.sections.map((section) => (
            <section key={section.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                {section.id} — {section.title}
              </h3>
              {section.sparkline && section.sparkline.length >= 2 ? (
                <div className="mb-2 h-12 flex items-end gap-0.5" aria-hidden>
                  {section.sparkline.map((v, i) => {
                    const max = Math.max(...section.sparkline!, 1);
                    const min = Math.min(...section.sparkline!, 0);
                    const span = max - min || 1;
                    const h = Math.max(4, ((v - min) / span) * 100);
                    return (
                      <div
                        key={`${section.id}-${i}`}
                        className="flex-1 rounded-t bg-indigo-500/70 min-w-[2px]"
                        style={{ height: `${h}%` }}
                      />
                    );
                  })}
                </div>
              ) : null}
              <p className="text-sm text-slate-700 leading-relaxed">{section.body}</p>
            </section>
          ))}
          <p className="text-[11px] text-slate-500">
            FX {model.sarPerUsd.toFixed(4)} SAR/USD · Generated {new Date(model.generatedAtIso).toLocaleString()}
          </p>
        </div>
      </aside>
    </div>
  );
};

export default MetricPassportDrawer;
