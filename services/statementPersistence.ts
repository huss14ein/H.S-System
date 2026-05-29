/** Minimal statement shape for DB upsert (avoids circular import from context). */
export type StatementPersistInput = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
  processedAt?: Date;
  status: string;
  bankName?: string;
  accountNumber?: string;
  accountType?: string;
  accountId?: string | null;
  statementPeriod: { startDate: Date; endDate: Date };
  openingBalance: number;
  closingBalance: number;
  confidence: number;
  summary: unknown;
  errors?: string[];
  storageBucket?: string;
  storagePath?: string;
};

/** Metadata-only columns for list hydrate (boot). */
export const STATEMENT_LIST_SELECT =
  'id, file_name, file_type, file_size, uploaded_at, processed_at, status, bank_name, account_number, account_type, account_id, statement_period_start, statement_period_end, opening_balance, closing_balance, confidence, summary, errors, storage_bucket, storage_path';

export const STATEMENT_DETAIL_SELECT = '*, extracted_transactions(*)';

export function isStatementUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** True when DB writes on statement state change are allowed (not initial hydrate). */
export function shouldPersistStatementsAfterHydrate(hydrated: boolean, statementsLength: number): boolean {
  return hydrated && statementsLength > 0;
}

export type StatementUpsertRow = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_id?: string | null;
  statement_period_start: string;
  statement_period_end: string;
  opening_balance: number;
  closing_balance: number;
  status: string;
  confidence: number;
  summary: unknown;
  errors: unknown[];
  uploaded_at: string;
  processed_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  /** Omit on read-back sync to avoid bumping row on load. */
  updated_at?: string;
};

export function buildStatementUpsertRow(
  statement: StatementPersistInput,
  userId: string,
  options?: { touchUpdatedAt?: boolean },
): StatementUpsertRow {
  const row: StatementUpsertRow = {
    id: statement.id,
    user_id: userId,
    file_name: statement.fileName,
    file_type: statement.fileType,
    file_size: statement.fileSize,
    bank_name: statement.bankName ?? null,
    account_number: statement.accountNumber ?? null,
    account_type: statement.accountType ?? null,
    account_id: statement.accountId ?? null,
    statement_period_start: statement.statementPeriod.startDate.toISOString().split('T')[0],
    statement_period_end: statement.statementPeriod.endDate.toISOString().split('T')[0],
    opening_balance: statement.openingBalance,
    closing_balance: statement.closingBalance,
    status: statement.status,
    confidence: statement.confidence,
    summary: statement.summary,
    errors: statement.errors || [],
    uploaded_at: statement.uploadedAt.toISOString(),
    processed_at: statement.processedAt?.toISOString() ?? null,
    storage_bucket: statement.storageBucket ?? null,
    storage_path: statement.storagePath ?? null,
  };
  if (options?.touchUpdatedAt !== false) {
    row.updated_at = new Date().toISOString();
  }
  return row;
}
