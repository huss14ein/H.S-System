import type { ReconciliationEntityType, ReconciliationMechanism } from './constants';

export type ReconciliationAdjustmentStatus = 'applied' | 'reversed' | 'noop';

export interface ReconciliationAdjustment {
  id: string;
  user_id?: string;
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
  status: ReconciliationAdjustmentStatus;
  reversedByAdjustmentId?: string | null;
  reversesAdjustmentId?: string | null;
  generatedTransactionId?: string | null;
  generatedInvestmentTransactionId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export type ReconciliationRunStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed';

export interface ReconciliationRun {
  id: string;
  user_id?: string;
  adjustmentId?: string | null;
  status: ReconciliationRunStatus;
  effectiveFrom?: string | null;
  entityType?: string | null;
  entityIds?: string[];
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  completedAt?: string | null;
}

export type ReconciliationAuditKind =
  | 'adjustment'
  | 'correction'
  | 'reversal'
  | 'corporate_action'
  | 'revaluation'
  | 'noop'
  | 'error';

export interface ReconciliationAuditEvent {
  id: string;
  user_id?: string;
  at: string;
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
}

export interface ReconciliationPreview {
  entityType: ReconciliationEntityType;
  entityId: string;
  mechanism: ReconciliationMechanism;
  beforeValue: number;
  actualValue: number;
  delta: number;
  currency: 'SAR' | 'USD';
  accountType?: string;
  noop: boolean;
  impacts: string[];
  blockedReason?: string;
}

export interface ApplyReconciliationInput {
  mechanism: ReconciliationMechanism;
  entityType: ReconciliationEntityType;
  entityId: string;
  actualValue: number;
  reason: string;
  effectiveDate?: string;
  currency?: 'SAR' | 'USD';
  costBasisTotal?: number;
  /**
   * Restate remaining weighted-average cost (broker book). When set with unchanged or
   * decreased qty, replaces holding.avgCost. Ignored on qty-up (use costBasisTotal for added shares).
   */
  targetAvgCost?: number;
  /**
   * Restate total remaining cost basis (avgCost × qty). Takes precedence over targetAvgCost
   * when both are provided. On qty-up this is treated as the full new book (not only added shares).
   */
  targetBookCost?: number;
  /** When true after reconcile, scale open-lot costs so FIFO book matches WAC book. Default true when cost is restated. */
  alignLotCostsToBook?: boolean;
  /** Client nonce so intentional repeats with same delta are allowed. */
  clientNonce?: string;
  metadata?: Record<string, unknown>;
  /** Confirm backdated cash reconcile. */
  confirmBackdated?: boolean;
  portfolioId?: string;
  symbol?: string;
  accountId?: string;
}

export interface ApplyReconciliationResult {
  ok: boolean;
  noop?: boolean;
  adjustment?: ReconciliationAdjustment;
  audit?: ReconciliationAuditEvent;
  run?: ReconciliationRun | null;
  error?: string;
  /** Patch hints for DataContext (already applied when ok). */
  patch?: Record<string, unknown>;
}

export function normalizeReconciliationAdjustmentRow(row: Record<string, unknown>): ReconciliationAdjustment {
  return {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : undefined,
    mechanism: row.mechanism as ReconciliationAdjustment['mechanism'],
    entityType: (row.entity_type ?? row.entityType) as ReconciliationAdjustment['entityType'],
    entityId: String(row.entity_id ?? row.entityId),
    portfolioId: (row.portfolio_id ?? row.portfolioId) as string | null | undefined,
    accountId: (row.account_id ?? row.accountId) as string | null | undefined,
    symbol: (row.symbol as string | null | undefined) ?? null,
    effectiveDate: String(row.effective_date ?? row.effectiveDate).slice(0, 10),
    currency: ((row.currency as string) === 'USD' ? 'USD' : 'SAR'),
    beforeValue: Number(row.before_value ?? row.beforeValue ?? 0),
    actualValue: Number(row.actual_value ?? row.actualValue ?? 0),
    delta: Number(row.delta ?? 0),
    costBasisTotal:
      row.cost_basis_total != null || row.costBasisTotal != null
        ? Number(row.cost_basis_total ?? row.costBasisTotal)
        : null,
    reason: String(row.reason ?? ''),
    idempotencyKey: String(row.idempotency_key ?? row.idempotencyKey ?? ''),
    status: (row.status as ReconciliationAdjustmentStatus) ?? 'applied',
    reversedByAdjustmentId: (row.reversed_by_adjustment_id ?? row.reversedByAdjustmentId) as
      | string
      | null
      | undefined,
    reversesAdjustmentId: (row.reverses_adjustment_id ?? row.reversesAdjustmentId) as
      | string
      | null
      | undefined,
    generatedTransactionId: (row.generated_transaction_id ?? row.generatedTransactionId) as
      | string
      | null
      | undefined,
    generatedInvestmentTransactionId: (row.generated_investment_transaction_id ??
      row.generatedInvestmentTransactionId) as string | null | undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at != null ? String(row.created_at) : row.createdAt != null ? String(row.createdAt) : undefined,
  };
}

export function normalizeReconciliationAuditRow(row: Record<string, unknown>): ReconciliationAuditEvent {
  return {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : undefined,
    at: String(row.at ?? row.created_at ?? new Date().toISOString()),
    kind: (row.kind as ReconciliationAuditKind) ?? 'adjustment',
    mechanism: String(row.mechanism ?? ''),
    entityType: String(row.entity_type ?? row.entityType ?? ''),
    entityId: String(row.entity_id ?? row.entityId ?? ''),
    effectiveDate: row.effective_date != null || row.effectiveDate != null
      ? String(row.effective_date ?? row.effectiveDate).slice(0, 10)
      : null,
    beforeValue: row.before_value != null || row.beforeValue != null ? Number(row.before_value ?? row.beforeValue) : null,
    afterValue: row.after_value != null || row.afterValue != null ? Number(row.after_value ?? row.afterValue) : null,
    delta: row.delta != null ? Number(row.delta) : null,
    currency: row.currency != null ? String(row.currency) : null,
    reason: row.reason != null ? String(row.reason) : null,
    adjustmentId: (row.adjustment_id ?? row.adjustmentId) as string | null | undefined,
    runId: (row.run_id ?? row.runId) as string | null | undefined,
    summary: String(row.summary ?? ''),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export function normalizeReconciliationRunRow(row: Record<string, unknown>): ReconciliationRun {
  const ids = row.entity_ids ?? row.entityIds;
  return {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : undefined,
    adjustmentId: (row.adjustment_id ?? row.adjustmentId) as string | null | undefined,
    status: (row.status as ReconciliationRunStatus) ?? 'pending',
    effectiveFrom: row.effective_from != null || row.effectiveFrom != null
      ? String(row.effective_from ?? row.effectiveFrom).slice(0, 10)
      : null,
    entityType: (row.entity_type ?? row.entityType) as string | null | undefined,
    entityIds: Array.isArray(ids) ? ids.map(String) : [],
    errorMessage: (row.error_message ?? row.errorMessage) as string | null | undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at != null ? String(row.created_at) : undefined,
    completedAt: row.completed_at != null || row.completedAt != null
      ? String(row.completed_at ?? row.completedAt)
      : null,
  };
}
