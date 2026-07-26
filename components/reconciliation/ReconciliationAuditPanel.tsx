import React, { useMemo, useState } from 'react';
import { useContext } from 'react';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { auditEventsToCsv, type ReconciliationAuditEvent } from '../../services/reconciliation';
import { toast } from '../../context/ToastContext';

const ReconciliationAuditPanel: React.FC = () => {
  const ctx = useContext(DataContext);
  const auth = useContext(AuthContext);
  const events = (ctx?.data?.reconciliationAuditEvents ?? []) as ReconciliationAuditEvent[];
  const adjustments = ctx?.data?.reconciliationAdjustments ?? [];
  const runs = ctx?.data?.reconciliationRuns ?? [];
  const reverse = ctx?.reverseReconciliationAdjustment;
  const refreshAudit = ctx?.refreshReconciliationAudit;
  const retryRun = ctx?.retryReconciliationRun;
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [mechanismFilter, setMechanismFilter] = useState<string>('all');
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const actorLabel =
    auth?.user?.email ||
    (auth?.user as { user_metadata?: { full_name?: string } } | null)?.user_metadata?.full_name ||
    auth?.user?.id ||
    'owner';

  const runsById = useMemo(() => {
    const map = new Map<string, { status?: string }>();
    for (const r of runs) map.set(r.id, { status: r.status });
    return map;
  }, [runs]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (mechanismFilter !== 'all' && e.mechanism !== mechanismFilter) return false;
      return true;
    });
  }, [events, kindFilter, mechanismFilter]);

  const mechanisms = useMemo(
    () => Array.from(new Set(events.map((e) => e.mechanism).filter(Boolean))).sort(),
    [events],
  );

  const handleExport = () => {
    const csv = auditEventsToCsv(filtered, { runsById, actorLabel });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finova-reconciliation-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Audit log exported.', 'success');
  };

  const handleReverse = async () => {
    if (!reverseId || !reverse) return;
    const result = await reverse(reverseId, reverseReason);
    if (!result.ok) {
      toast(result.error || 'Reverse failed', 'error');
      return;
    }
    toast('Adjustment reversed.', 'success');
    setReverseId(null);
    setReverseReason('');
  };

  return (
    <div id="reconciliation-audit-log" className="space-y-4 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Reconciliation audit</h3>
          <p className="text-sm text-slate-600">
            Authoritative append-only trail from Supabase. Local Settings activity log is not the source of truth.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {refreshAudit && (
            <button
              type="button"
              className="btn-outline text-sm"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                const result = await refreshAudit();
                setRefreshing(false);
                if (!result.ok) toast(result.error || 'Could not refresh the audit trail.', 'error');
                else toast('Audit trail refreshed from the database.', 'success');
              }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh from DB'}
            </button>
          )}
          <button type="button" className="btn-outline text-sm" onClick={handleExport} disabled={!filtered.length}>
            Export CSV
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-slate-600">
          Kind{' '}
          <select className="select-base ml-1" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="adjustment">adjustment</option>
            <option value="revaluation">revaluation</option>
            <option value="reversal">reversal</option>
            <option value="corporate_action">corporate_action</option>
            <option value="noop">noop</option>
            <option value="error">error</option>
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Mechanism{' '}
          <select
            className="select-base ml-1"
            value={mechanismFilter}
            onChange={(e) => setMechanismFilter(e.target.value)}
          >
            <option value="all">All</option>
            {mechanisms.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      {runs.some((r) => r.status === 'blocked' || r.status === 'failed' || r.status === 'pending') && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p>
            {runs.filter((r) => r.status === 'blocked' || r.status === 'failed' || r.status === 'pending').length}{' '}
            replay run(s) need attention. Retry after unlocking the month or supplying historical marks — ROI is never
            invented.
          </p>
          {retryRun && (
            <ul className="space-y-1">
              {runs
                .filter((r) => r.status === 'blocked' || r.status === 'failed' || r.status === 'pending')
                .slice(0, 8)
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono">{String(r.id).slice(0, 8)}</span>
                    <span className="uppercase tracking-wide">{r.status}</span>
                    <span className="text-amber-800/80 truncate max-w-[16rem]" title={r.errorMessage ?? ''}>
                      {r.errorMessage || '—'}
                    </span>
                    <button
                      type="button"
                      className="font-medium text-amber-950 underline disabled:opacity-50"
                      disabled={retryingId === r.id}
                      onClick={async () => {
                        setRetryingId(r.id);
                        const result = await retryRun(r.id);
                        setRetryingId(null);
                        if (!result.ok) toast(result.error || 'Retry failed', 'error');
                        else toast('Replay run completed.', 'success');
                      }}
                    >
                      {retryingId === r.id ? 'Retrying…' : 'Retry'}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No reconciliation audit events yet. Apply Reconcile Balance or a revaluation to populate this log.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-2">At</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Mechanism</th>
                <th className="p-2">Target</th>
                <th className="p-2">Effective</th>
                <th className="p-2">Before → After</th>
                <th className="p-2">Δ</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Run</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const adj = adjustments.find((a) => a.id === e.adjustmentId);
                const run = e.runId ? runsById.get(e.runId) : undefined;
                const canReverse =
                  e.adjustmentId &&
                  adj &&
                  adj.status === 'applied' &&
                  !adj.reversedByAdjustmentId &&
                  e.kind !== 'reversal' &&
                  e.kind !== 'noop';
                return (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className="p-2 whitespace-nowrap text-slate-600">{new Date(e.at).toLocaleString()}</td>
                    <td className="p-2">{e.kind}</td>
                    <td className="p-2">{e.mechanism}</td>
                    <td className="p-2 font-mono text-xs">
                      {e.entityType}:{String(e.entityId).slice(0, 8)}
                    </td>
                    <td className="p-2">{e.effectiveDate ?? '—'}</td>
                    <td className="p-2 tabular-nums">
                      {e.beforeValue ?? '—'} → {e.afterValue ?? '—'} {e.currency ?? ''}
                    </td>
                    <td className="p-2 tabular-nums">{e.delta ?? '—'}</td>
                    <td className="p-2 text-xs text-slate-600 max-w-[8rem] truncate" title={actorLabel}>
                      {e.user_id ? actorLabel : '—'}
                    </td>
                    <td className="p-2 text-xs">
                      {run?.status ? (
                        <span
                          className={
                            run.status === 'completed'
                              ? 'text-emerald-700'
                              : run.status === 'blocked' || run.status === 'failed'
                                ? 'text-amber-800 font-medium'
                                : 'text-slate-600'
                          }
                        >
                          {run.status}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-2 max-w-[14rem] truncate" title={e.reason ?? e.summary}>
                      {e.reason || e.summary}
                    </td>
                    <td className="p-2">
                      {canReverse ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-700 hover:underline"
                          onClick={() => {
                            setReverseId(e.adjustmentId!);
                            setReverseReason('');
                          }}
                        >
                          Undo
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {reverseId && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-3">
          <p className="text-sm text-rose-900">
            Reverse adjustment <span className="font-mono text-xs">{reverseId}</span>? This posts an inverse delta and
            cannot be reversed again (apply a new forward adjustment if needed).
          </p>
          <input
            className="input-base"
            placeholder="Reason (required)"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            minLength={3}
          />
          <div className="flex gap-2">
            <button type="button" className="btn-outline" onClick={() => setReverseId(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary bg-rose-700 hover:bg-rose-800" onClick={handleReverse}>
              Confirm reverse
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReconciliationAuditPanel;
