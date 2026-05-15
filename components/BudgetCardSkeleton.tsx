import React from 'react';

/** Placeholder while budgets data or governance (permissions / shared sync) is loading. */
const BudgetCardSkeleton: React.FC<{ density?: 'normal' | 'compact' }> = ({ density = 'normal' }) => {
    const h = density === 'compact' ? 'min-h-[200px]' : 'min-h-[280px]';
    return (
        <div
            className={`flex h-full w-full flex-col rounded-3xl border border-slate-200/90 bg-gradient-to-br from-slate-100/90 via-white/60 to-slate-50/80 p-5 shadow-sm animate-pulse ${h}`}
            aria-hidden
        >
            <div className="flex gap-4">
                <div className="h-14 w-14 shrink-0 rounded-full bg-slate-200/90" />
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-2/3 max-w-[200px] rounded bg-slate-200/90" />
                    <div className="h-3 w-2/5 max-w-[120px] rounded bg-slate-200/70" />
                    <div className="h-3 w-5/6 max-w-[280px] rounded bg-slate-200/60" />
                </div>
            </div>
            <div className="mt-5 flex-1 space-y-3">
                <div className="h-20 w-full rounded-2xl bg-violet-100/60" />
                <div className="h-14 w-full rounded-2xl bg-slate-200/50" />
                <div className="h-3 w-full rounded bg-slate-200/40" />
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-200/50 pt-3">
                <div className="h-8 w-8 rounded-lg bg-slate-200/70" />
                <div className="h-8 w-8 rounded-lg bg-slate-200/70" />
            </div>
        </div>
    );
};

export default BudgetCardSkeleton;
