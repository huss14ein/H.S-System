import React from 'react';

type Props = {
  visible: boolean;
  syncing: boolean;
  onRetry: () => void;
};

/** Top-of-page alert when shared-budget RPC is down (migration / network). */
const BudgetSharedRpcBanner: React.FC<Props> = ({ visible, syncing, onRetry }) => {
  if (!visible) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm"
      role="alert"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm text-amber-950">
          <p className="font-semibold">Shared budget totals are unavailable</p>
          <p className="mt-1 text-amber-900/90 leading-relaxed">
            Your own budget cards still work. Shared cards need Supabase function{' '}
            <code className="text-[11px] bg-amber-100/80 px-1 rounded">get_shared_budget_consumed_for_me</code>{' '}
            — apply migration <code className="text-[11px] bg-amber-100/80 px-1 rounded">20260527120000_fix_shared_budget_consumed_date_trim.sql</code>{' '}
            (fixes <code className="text-[11px]">btrim(date)</code> errors), then retry.
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-60"
          disabled={syncing}
          onClick={onRetry}
        >
          {syncing ? 'Retrying…' : 'Retry shared totals'}
        </button>
      </div>
    </div>
  );
};

export default React.memo(BudgetSharedRpcBanner);
