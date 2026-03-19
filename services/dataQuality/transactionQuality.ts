import type { Transaction } from '../../types';

const MAX_DESCRIPTION_LEN = 500;
const AMOUNT_EPSILON = 0.01;

function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function descriptionsLikelySame(a: string, b: string): boolean {
  const A = normalizeDesc(a);
  const B = normalizeDesc(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const prefix = 12;
  const shortA = A.slice(0, prefix);
  const shortB = B.slice(0, prefix);
  return A.includes(shortB) || B.includes(shortA);
}

function calendarDaysApart(d1: Date, d2: Date): number {
  const t1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const t2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

export interface ValidateTransactionInput {
  date: string;
  description: string;
  amount: number | string;
  accountId: string;
  type: 'income' | 'expense';
  category?: string;
}

/**
 * Strict validation before persisting a manual transaction.
 */
export function validateTransactionRequiredFields(input: ValidateTransactionInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!input.date || String(input.date).trim() === '') {
    errors.push('Date is required.');
  } else {
    const d = new Date(input.date);
    if (Number.isNaN(d.getTime())) {
      errors.push('Date is not valid.');
    } else {
      const y = d.getFullYear();
      if (y < 1990 || y > 2100) {
        errors.push('Date year must be between 1990 and 2100.');
      }
    }
  }

  const desc = String(input.description ?? '').trim();
  if (!desc) {
    errors.push('Description is required.');
  } else if (desc.length > MAX_DESCRIPTION_LEN) {
    errors.push(`Description must be at most ${MAX_DESCRIPTION_LEN} characters.`);
  }

  const raw = input.amount;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
  if (raw === '' || raw === null || raw === undefined || Number.isNaN(n)) {
    errors.push('Amount must be a valid number.');
  } else if (!Number.isFinite(n)) {
    errors.push('Amount must be finite.');
  } else if (Math.abs(n) < AMOUNT_EPSILON) {
    errors.push('Amount must be greater than zero.');
  }

  if (!input.accountId || String(input.accountId).trim() === '') {
    errors.push('Account is required.');
  }

  if (input.type !== 'income' && input.type !== 'expense') {
    errors.push('Transaction type must be income or expense.');
  }

  const cat = String(input.category ?? '').trim();
  if (input.type === 'expense' && !cat) {
    errors.push('Category is required for expenses.');
  }

  return { valid: errors.length === 0, errors };
}

export interface DuplicateCheckOptions {
  /** When editing, exclude this transaction id from matches. */
  excludeId?: string;
  /** Max calendar days between dates to consider a duplicate (default 2 for manual entry). */
  dateToleranceDays?: number;
  /** If true (default), candidate must match existing row's accountId. Set false for statement import rows before account mapping. */
  requireSameAccount?: boolean;
}

/**
 * Returns existing transactions that look like duplicates of the candidate.
 * Aligned with statement-import heuristics; stricter when requireSameAccount is true.
 */
export function findDuplicateTransactions(
  candidate: Pick<Transaction, 'date' | 'amount' | 'description' | 'accountId' | 'type'>,
  existing: Transaction[],
  options?: DuplicateCheckOptions
): Transaction[] {
  const dateTol = options?.dateToleranceDays ?? 2;
  const requireAcct = options?.requireSameAccount !== false;
  const excludeId = options?.excludeId;

  const candDate = new Date(candidate.date);
  if (Number.isNaN(candDate.getTime())) return [];

  const candAmt = Math.abs(Number(candidate.amount) || 0);
  const candType = candidate.type;

  return (existing || []).filter((row) => {
    if (excludeId && row.id === excludeId) return false;
    if (row.type !== candType) return false;
    if (requireAcct && row.accountId !== candidate.accountId) return false;

    const rowDate = new Date(row.date);
    if (Number.isNaN(rowDate.getTime())) return false;
    if (calendarDaysApart(candDate, rowDate) > dateTol) return false;

    const rowAmt = Math.abs(Number(row.amount) || 0);
    if (Math.abs(candAmt - rowAmt) > AMOUNT_EPSILON) return false;

    if (!descriptionsLikelySame(candidate.description || '', row.description || '')) return false;

    return true;
  });
}

/**
 * Single match check for import pipelines (shared with StatementUpload-style logic).
 */
export function detectDuplicateTransaction(
  candidate: Pick<Transaction, 'date' | 'amount' | 'description' | 'accountId' | 'type'>,
  existing: Transaction[],
  options?: DuplicateCheckOptions
): { isDuplicate: boolean; matches: Transaction[] } {
  const matches = findDuplicateTransactions(candidate, existing, options);
  return { isDuplicate: matches.length > 0, matches };
}
