import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReconciliationAdjustment, ReconciliationAuditEvent, ReconciliationRun } from './types';
import {
  normalizeReconciliationAdjustmentRow,
  normalizeReconciliationAuditRow,
  normalizeReconciliationRunRow,
} from './types';
import type { ReconciliationAuditKind } from './types';
import type { ReconciliationEntityType, ReconciliationMechanism } from './constants';

export async function insertReconciliationAdjustment(
  db: SupabaseClient,
  userId: string,
  row: {
    mechanism: ReconciliationMechanism;
    entityType: ReconciliationEntityType;
    entityId: string;
    portfolioId?: string | null;
    accountId?: string | null;
    symbol?: string | null;
    effectiveDate: string;
    currency: 'SAR' | 'USD';
    beforeValue: number;
    actualValue: number;
    delta: number;
    costBasisTotal?: number | null;
    reason: string;
    idempotencyKey: string;
    status?: 'applied' | 'reversed' | 'noop';
    reversesAdjustmentId?: string | null;
    generatedTransactionId?: string | null;
    generatedInvestmentTransactionId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ data: ReconciliationAdjustment | null; error: Error | null; duplicate?: boolean }> {
  const payload = {
    user_id: userId,
    mechanism: row.mechanism,
    entity_type: row.entityType,
    entity_id: row.entityId,
    portfolio_id: row.portfolioId ?? null,
    account_id: row.accountId ?? null,
    symbol: row.symbol ?? null,
    effective_date: row.effectiveDate.slice(0, 10),
    currency: row.currency,
    before_value: row.beforeValue,
    actual_value: row.actualValue,
    delta: row.delta,
    cost_basis_total: row.costBasisTotal ?? null,
    reason: row.reason,
    idempotency_key: row.idempotencyKey,
    status: row.status ?? 'applied',
    reverses_adjustment_id: row.reversesAdjustmentId ?? null,
    generated_transaction_id: row.generatedTransactionId ?? null,
    generated_investment_transaction_id: row.generatedInvestmentTransactionId ?? null,
    metadata: row.metadata ?? {},
  };
  const { data, error } = await db.from('reconciliation_adjustments').insert(payload).select().single();
  if (error) {
    if (String(error.code) === '23505') {
      const existing = await db
        .from('reconciliation_adjustments')
        .select('*')
        .eq('user_id', userId)
        .eq('idempotency_key', row.idempotencyKey)
        .maybeSingle();
      if (existing.data) {
        return {
          data: normalizeReconciliationAdjustmentRow(existing.data as Record<string, unknown>),
          error: null,
          duplicate: true,
        };
      }
    }
    if (String(error.code) === 'PGRST205' || /does not exist|schema cache/i.test(String(error.message))) {
      return { data: null, error: null };
    }
    return { data: null, error: new Error(error.message) };
  }
  return {
    data: normalizeReconciliationAdjustmentRow(data as Record<string, unknown>),
    error: null,
  };
}

export async function insertReconciliationAudit(
  db: SupabaseClient,
  userId: string,
  row: {
    kind: ReconciliationAuditKind;
    mechanism: string;
    entityType: string;
    entityId: string;
    effectiveDate?: string | null;
    beforeValue?: number | null;
    afterValue?: number | null;
    delta?: number | null;
    currency?: string | null;
    reason?: string | null;
    adjustmentId?: string | null;
    runId?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ReconciliationAuditEvent | null> {
  const payload = {
    user_id: userId,
    kind: row.kind,
    mechanism: row.mechanism,
    entity_type: row.entityType,
    entity_id: row.entityId,
    effective_date: row.effectiveDate ?? null,
    before_value: row.beforeValue ?? null,
    after_value: row.afterValue ?? null,
    delta: row.delta ?? null,
    currency: row.currency ?? null,
    reason: row.reason ?? null,
    adjustment_id: row.adjustmentId ?? null,
    run_id: row.runId ?? null,
    summary: row.summary,
    metadata: row.metadata ?? {},
  };
  const { data, error } = await db.from('reconciliation_audit_events').insert(payload).select().single();
  if (error) {
    if (String(error.code) === 'PGRST205' || /does not exist|schema cache/i.test(String(error.message))) {
      return null;
    }
    console.warn('reconciliation_audit_events insert failed:', error.message);
    return null;
  }
  return normalizeReconciliationAuditRow(data as Record<string, unknown>);
}

export async function insertReconciliationRun(
  db: SupabaseClient,
  userId: string,
  row: {
    adjustmentId?: string | null;
    status: ReconciliationRun['status'];
    effectiveFrom?: string | null;
    entityType?: string | null;
    entityIds?: string[];
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<ReconciliationRun | null> {
  const payload = {
    user_id: userId,
    adjustment_id: row.adjustmentId ?? null,
    status: row.status,
    effective_from: row.effectiveFrom ?? null,
    entity_type: row.entityType ?? null,
    entity_ids: row.entityIds ?? [],
    error_message: row.errorMessage ?? null,
    metadata: row.metadata ?? {},
    completed_at: row.status === 'completed' || row.status === 'failed' || row.status === 'blocked'
      ? new Date().toISOString()
      : null,
  };
  const { data, error } = await db.from('reconciliation_runs').insert(payload).select().single();
  if (error) {
    if (String(error.code) === 'PGRST205' || /does not exist|schema cache/i.test(String(error.message))) {
      return null;
    }
    console.warn('reconciliation_runs insert failed:', error.message);
    return null;
  }
  return normalizeReconciliationRunRow(data as Record<string, unknown>);
}

export async function updateReconciliationRunStatus(
  db: SupabaseClient,
  userId: string,
  runId: string,
  patch: {
    status: ReconciliationRun['status'];
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<ReconciliationRun | null> {
  const payload: Record<string, unknown> = {
    status: patch.status,
    error_message: patch.errorMessage ?? null,
    completed_at:
      patch.status === 'completed' || patch.status === 'failed' || patch.status === 'blocked'
        ? new Date().toISOString()
        : null,
  };
  if (patch.metadata) payload.metadata = patch.metadata;
  const { data, error } = await db
    .from('reconciliation_runs')
    .update(payload)
    .eq('id', runId)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) {
    if (String(error.code) === 'PGRST205' || /does not exist|schema cache/i.test(String(error.message))) {
      return null;
    }
    console.warn('reconciliation_runs update failed:', error.message);
    return null;
  }
  return data ? normalizeReconciliationRunRow(data as Record<string, unknown>) : null;
}

export async function markAdjustmentReversed(
  db: SupabaseClient,
  userId: string,
  adjustmentId: string,
  reversedById: string,
): Promise<{ error: Error | null }> {
  const { error } = await db
    .from('reconciliation_adjustments')
    .update({ status: 'reversed', reversed_by_adjustment_id: reversedById })
    .match({ id: adjustmentId, user_id: userId });
  if (error && String(error.code) !== 'PGRST205') {
    return { error: new Error(error.message) };
  }
  return { error: null };
}

export async function fetchReconciliationAuditEvents(
  db: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<ReconciliationAuditEvent[]> {
  const { data, error } = await db
    .from('reconciliation_audit_events')
    .select('*')
    .eq('user_id', userId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as any[]) || []).map((r) => normalizeReconciliationAuditRow(r));
}

export async function fetchReconciliationAdjustments(
  db: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<ReconciliationAdjustment[]> {
  const { data, error } = await db
    .from('reconciliation_adjustments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as any[]) || []).map((r) => normalizeReconciliationAdjustmentRow(r));
}

export async function fetchReconciliationRuns(
  db: SupabaseClient,
  userId: string,
  limit = 100,
): Promise<ReconciliationRun[]> {
  const { data, error } = await db
    .from('reconciliation_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as any[]) || []).map((r) => normalizeReconciliationRunRow(r));
}

export function auditEventsToCsv(
  events: ReconciliationAuditEvent[],
  opts?: { runsById?: Map<string, { status?: string }>; actorLabel?: string },
): string {
  const header = [
    'at',
    'kind',
    'mechanism',
    'entityType',
    'entityId',
    'effectiveDate',
    'before',
    'after',
    'delta',
    'currency',
    'reason',
    'summary',
    'adjustmentId',
    'actor',
    'runId',
    'runStatus',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const e of events) {
    const run = e.runId && opts?.runsById ? opts.runsById.get(e.runId) : undefined;
    lines.push(
      [
        e.at,
        e.kind,
        e.mechanism,
        e.entityType,
        e.entityId,
        e.effectiveDate ?? '',
        e.beforeValue ?? '',
        e.afterValue ?? '',
        e.delta ?? '',
        e.currency ?? '',
        e.reason ?? '',
        e.summary,
        e.adjustmentId ?? '',
        opts?.actorLabel ?? e.user_id ?? '',
        e.runId ?? '',
        run?.status ?? '',
      ]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\n');
}
