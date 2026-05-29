import React from 'react';

type Props = {
  rpcUnavailable: boolean;
  syncing: boolean;
  sharedCardCount: number;
  hasUser: boolean;
};

/** Shared-budget RPC status for Budget Intelligence (extracted from Budgets.tsx). */
const BudgetSharedRpcStatusLine: React.FC<Props> = ({ rpcUnavailable, syncing, sharedCardCount, hasUser }) => {
  if (rpcUnavailable) {
    return (
      <span className="font-medium text-amber-800" role="alert">
        Shared budget totals unavailable — apply the latest Supabase migration for{' '}
        <code className="text-[10px]">get_shared_budget_consumed_for_me</code> or retry later.
      </span>
    );
  }
  if (hasUser && syncing) {
    return <span className="font-medium text-indigo-700">Refreshing shared-budget totals for this window…</span>;
  }
  if (sharedCardCount > 0) {
    return <>Totals and health counts include your budgets plus {sharedCardCount} shared card(s).</>;
  }
  return <>Totals reflect the budgets shown above for the selected view.</>;
};

export default React.memo(BudgetSharedRpcStatusLine);
