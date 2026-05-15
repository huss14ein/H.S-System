import React from 'react';

/** Placeholder while signed-in household profile is merging from cloud into local state. */
const HouseholdEngineSkeleton: React.FC = () => (
    <div
        className="rounded-2xl border border-cyan-100/90 bg-gradient-to-br from-white via-slate-50 to-cyan-50/30 p-5 shadow-sm animate-pulse"
        aria-busy="true"
        aria-label="Loading household engine"
    >
        <div className="rounded-2xl border border-white/80 bg-white/60 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="h-7 w-24 rounded-full bg-cyan-100/90" />
                    <div className="h-4 w-48 max-w-full rounded bg-slate-200/80" />
                </div>
                <div className="flex gap-2 shrink-0">
                    <div className="h-9 w-28 rounded-xl bg-slate-200/80" />
                    <div className="h-9 w-28 rounded-xl bg-slate-200/70" />
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={`hh-sk-tile-${i}`} className="rounded-xl border border-slate-200/60 bg-slate-100/50 p-3 space-y-2">
                        <div className="h-3 w-2/3 rounded bg-slate-200/80" />
                        <div className="h-7 w-4/5 rounded bg-slate-200/70" />
                        <div className="h-2.5 w-full rounded bg-slate-200/50" />
                    </div>
                ))}
            </div>
            <div className="h-24 w-full rounded-xl bg-slate-100/70 border border-slate-200/40" />
        </div>
    </div>
);

export default HouseholdEngineSkeleton;
