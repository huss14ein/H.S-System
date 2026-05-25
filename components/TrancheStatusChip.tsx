import type { PlannedTrade } from '../types';

/** Visual chip for multi-tranche planned trades (Investment Plan + Execution History). */
export function TrancheStatusChip({ plan }: { plan: Pick<PlannedTrade, 'trancheIndex' | 'trancheGroupId' | 'targetQty' | 'filledQty' | 'status'> }) {
  const idx = plan.trancheIndex ?? 1;
  const target = plan.targetQty;
  const filled = plan.filledQty ?? 0;
  const hasTranche = idx > 1 || !!plan.trancheGroupId || target != null || filled > 0;
  if (!hasTranche) return null;

  const pct =
    target != null && Number(target) > 0
      ? Math.min(100, Math.round((filled / Number(target)) * 100))
      : null;

  return (
    <span
      className="inline-flex flex-wrap items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-900"
      title={plan.trancheGroupId ? `Tranche group ${plan.trancheGroupId.slice(0, 8)}…` : undefined}
    >
      <span>T{idx}</span>
      {target != null && (
        <span className="font-normal text-indigo-800 tabular-nums">
          {filled}/{target}
          {pct != null ? ` (${pct}%)` : ''}
        </span>
      )}
      <span className="font-normal text-indigo-700/90">{plan.status}</span>
    </span>
  );
}
