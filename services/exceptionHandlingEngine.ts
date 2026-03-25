/**
 * Exception and error handling logic (spec §26).
 * Missing price, duplicate import, broken FX, invalid goal rule, etc.
 */

export interface SystemException {
  code: string;
  message: string;
  entity?: string;
  entityId?: string;
  severity: 'warning' | 'error';
}

/** Run basic integrity checks: missing refs, negative balances, orphan refs. */
export function validateSystemIntegrity(args: {
  accounts: { id: string; balance?: number }[];
  transactions: { accountId?: string }[];
  goals: { id: string }[];
}): { ok: boolean; exceptions: SystemException[] } {
  const exceptions: SystemException[] = [];
  const accountIds = new Set((args.accounts ?? []).map((a) => a.id));

  (args.transactions ?? []).forEach((t) => {
    const aid = t.accountId;
    if (aid && !accountIds.has(aid)) {
      exceptions.push({ code: 'BROKEN_REF', message: 'Transaction references missing account', entityId: aid, entity: 'transaction', severity: 'error' });
    }
  });

  (args.accounts ?? []).forEach((a) => {
    const bal = Number(a.balance);
    if (Number.isFinite(bal) && bal < -1e9) {
      exceptions.push({ code: 'NEGATIVE_BALANCE', message: 'Account balance anomalously negative', entityId: a.id, entity: 'account', severity: 'warning' });
    }
  });

  return { ok: exceptions.length === 0, exceptions };
}

/** Detect broken references (e.g. goalId pointing to deleted goal). */
export function detectBrokenReferences(args: {
  goals: { id: string }[];
  accounts: { id: string }[];
  transactions: { goalId?: string; accountId?: string }[];
}): SystemException[] {
  const goalIds = new Set((args.goals ?? []).map((g) => g.id));
  const accountIds = new Set((args.accounts ?? []).map((a) => a.id));
  const out: SystemException[] = [];

  (args.transactions ?? []).forEach((t) => {
    if (t.goalId && !goalIds.has(t.goalId)) {
      out.push({ code: 'BROKEN_GOAL_REF', message: 'Transaction references missing goal', entityId: t.goalId, severity: 'warning' });
    }
    if (t.accountId && !accountIds.has(t.accountId)) {
      out.push({ code: 'BROKEN_ACCOUNT_REF', message: 'Transaction references missing account', entityId: t.accountId, severity: 'error' });
    }
  });
  return out;
}

/** In-memory exception queue (UI can consume and display). */
const _exceptionQueue: SystemException[] = [];

export function getExceptionQueue(): SystemException[] {
  return [..._exceptionQueue];
}

export function pushException(ex: SystemException): void {
  _exceptionQueue.push(ex);
  if (_exceptionQueue.length > 200) _exceptionQueue.shift();
}

export function clearExceptionQueue(): void {
  _exceptionQueue.length = 0;
}

/** Suggest repairs (e.g. "Set opening balance" for cash drift). */
export function repairSuggestionEngine(args: {
  cashDrift?: { accountId: string; drift: number; accountName?: string; bookCurrency?: string };
  missingCategory?: boolean;
}): { action: string; entityId?: string; detail?: string }[] {
  const suggestions: { action: string; entityId?: string; detail?: string }[] = [];
  if (args.cashDrift && Math.abs(args.cashDrift.drift) > 0) {
    const detail = [args.cashDrift.accountName, args.cashDrift.bookCurrency ? `book ${args.cashDrift.bookCurrency}` : null]
      .filter(Boolean)
      .join(' · ');
    suggestions.push({
      action: 'Set or correct opening balance for account to match transaction ledger',
      entityId: args.cashDrift.accountId,
      detail: detail || undefined,
    });
  }
  if (args.missingCategory) {
    suggestions.push({ action: 'Assign categories to uncategorized transactions' });
  }
  return suggestions;
}
