/** Categories / mechanisms for the Adjustment & Reconciliation Engine. */

export const RECONCILIATION_ADJUSTMENT_CATEGORY = 'Reconciliation Adjustment' as const;
export const OPENING_BALANCE_CATEGORY = 'Opening Balance' as const;

export const RECONCILIATION_LEDGER_CATEGORIES = [
  RECONCILIATION_ADJUSTMENT_CATEGORY,
  OPENING_BALANCE_CATEGORY,
] as const;

export type ReconciliationLedgerCategory = (typeof RECONCILIATION_LEDGER_CATEGORIES)[number];

export const RECONCILIATION_MECHANISMS = [
  'reconcile_balance',
  'opening_balance',
  'reconcile_quantity',
  'edit_trade',
  'sukuk_face_yield',
  'dividend_edit',
  'fee_vat_edit',
  'asset_revaluation',
  'commodity_revaluation',
  'liability_restatement',
  'corporate_action_undo',
  'corporate_action_correct',
  'reverse_adjustment',
] as const;

export type ReconciliationMechanism = (typeof RECONCILIATION_MECHANISMS)[number];

export const RECONCILIATION_ENTITY_TYPES = [
  'account',
  'holding',
  'investment_transaction',
  'sukuk_position',
  'asset',
  'commodity',
  'liability',
  'corporate_action',
  'adjustment',
] as const;

export type ReconciliationEntityType = (typeof RECONCILIATION_ENTITY_TYPES)[number];

export const REASON_MIN_LENGTH = 3;

export function isReconciliationLedgerCategory(category: string | undefined | null): boolean {
  const c = String(category ?? '').trim();
  return (
    c === RECONCILIATION_ADJUSTMENT_CATEGORY ||
    c === OPENING_BALANCE_CATEGORY ||
    c.toLowerCase() === RECONCILIATION_ADJUSTMENT_CATEGORY.toLowerCase() ||
    c.toLowerCase() === OPENING_BALANCE_CATEGORY.toLowerCase()
  );
}

/** Local calendar YYYY-MM-DD (app timezone / browser local), not UTC midnight. */
export function appCalendarTodayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeReason(reason: string | undefined | null): string {
  return String(reason ?? '').trim();
}

export function isValidReason(reason: string | undefined | null): boolean {
  return normalizeReason(reason).length >= REASON_MIN_LENGTH;
}

export function yearMonthFromYmd(ymd: string): string {
  return String(ymd).slice(0, 7);
}
