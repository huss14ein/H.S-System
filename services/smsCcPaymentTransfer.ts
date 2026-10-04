/**
 * Credit-card سداد / settlement SMS → transfer from funding cash account onto the card.
 * Never books as income/expense spending (no budget).
 */
import type { Account, Transaction } from '../types';
import {
  extractSmsCardLast4,
  parseSmsCardLast4FromNote,
  parseSmsTimeFromNote,
} from './smsImportRouting';
import {
  parseSmsKindFromNote,
  smsNoteWithAtmMeta,
  stripSmsAtmMeta,
} from './smsAtmCashTransfer';
import {
  smsLooksLikeCardSettlementCredit,
  smsTextLooksLikeCardSettlement,
} from './smsBankTransferPatterns';

export const SMS_CC_PAYMENT_KIND = 'cc_payment';

/** Prefer debt/bills/operating/salary roles when auto-picking the funding account. */
const FUNDING_ROLE_PRIORITY: ReadonlyArray<string> = [
  'debt_servicing',
  'bills_payment',
  'operating_cash',
  'salary_receiving',
];

export function isSmsCcPaymentTx(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  // Settlement always credits the card (positive). Never treat a debit as سداد payment.
  if (!(Number(tx.amount) > 0)) return false;
  if (/sms:kind=cc_payment\b/i.test(String(tx.note || ''))) return true;
  const blob = `${tx.description || ''}\n${tx.category || ''}\n${tx.note || ''}`;
  return smsTextLooksLikeCardSettlement(blob);
}

/** Like isSmsCcPaymentTx, but also accepts soft credits when the account is Credit. */
export function isSmsCcPaymentTxForAccount(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId'>,
  accounts: Array<Pick<Account, 'id' | 'type'>>,
): boolean {
  if (!(Number(tx.amount) > 0)) return false;
  if (/sms:kind=cc_payment\b/i.test(String(tx.note || ''))) return true;
  const blob = `${tx.description || ''}\n${tx.category || ''}\n${tx.note || ''}`;
  const acct = accounts.find((a) => a.id === String(tx.accountId || '').trim());
  return smsLooksLikeCardSettlementCredit({
    text: blob,
    amount: Number(tx.amount),
    accountType: acct?.type,
  });
}

export function parseSmsCcFundedFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:funded_from=([A-Za-z0-9_-]+)\b/i);
  return m?.[1] ? String(m[1]).trim() : null;
}

export function smsNoteWithCcPaymentMeta(
  existingNote: string | undefined,
  opts: {
    last4?: string | null;
    time?: string | null;
    fundedFromAccountId?: string | null;
  },
): string | undefined {
  const withoutFunded = String(existingNote || '')
    .replace(/\s*sms:funded_from=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = smsNoteWithAtmMeta(withoutFunded || undefined, {
    last4: opts.last4 ?? parseSmsCardLast4FromNote(existingNote),
    time: opts.time ?? parseSmsTimeFromNote(existingNote),
    kind: SMS_CC_PAYMENT_KIND,
    cashToAccountId: null,
  });
  const funded =
    opts.fundedFromAccountId != null
      ? String(opts.fundedFromAccountId).trim() || null
      : parseSmsCcFundedFromNote(existingNote);
  const parts: string[] = [];
  if (base) parts.push(base);
  if (funded) parts.push(`sms:funded_from=${funded}`);
  return parts.length ? parts.join(' ') : undefined;
}

export function stripSmsCcPaymentMeta(note: string | undefined): string {
  return stripSmsAtmMeta(note)
    .replace(/\s*sms:funded_from=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEligibleCcFundingAccount(
  account: Pick<Account, 'id' | 'type' | 'accountRole'> | null | undefined,
): boolean {
  if (!account) return false;
  if (account.type !== 'Checking' && account.type !== 'Savings') return false;
  // Physical cash wallets are ATM destinations, not typical CC funding sources.
  if (account.accountRole === 'physical_cash') return false;
  return true;
}

/**
 * Prefer a single Checking/Savings funding source (debt/bills/operating/salary roles first).
 * Never returns the destination card id.
 */
export function resolveCcPaymentFundingAccount(
  accounts: Account[],
  opts?: { excludeAccountIds?: Iterable<string> },
): { account: Account | null; candidates: Account[]; reason: 'role' | 'single' | 'none' | 'ambiguous' } {
  const exclude = new Set(
    [...(opts?.excludeAccountIds ?? [])].map((id) => String(id || '').trim()).filter(Boolean),
  );
  const eligible = accounts.filter(
    (a) => isEligibleCcFundingAccount(a) && !exclude.has(String(a.id || '').trim()),
  );
  if (eligible.length === 0) return { account: null, candidates: [], reason: 'none' };

  for (const role of FUNDING_ROLE_PRIORITY) {
    const byRole = eligible.filter((a) => a.accountRole === role);
    if (byRole.length === 1) return { account: byRole[0], candidates: byRole, reason: 'role' };
    if (byRole.length > 1) return { account: null, candidates: byRole, reason: 'ambiguous' };
  }

  if (eligible.length === 1) return { account: eligible[0], candidates: eligible, reason: 'single' };
  return { account: null, candidates: eligible, reason: 'ambiguous' };
}

export type SmsCcPaymentTransferResult = {
  transactions: Transaction[];
  warnings: string[];
  expandedCount: number;
  unresolvedCount: number;
};

/**
 * After last-4 routing: mark سداد settlements and attach `sms:funded_from` when resolvable.
 * Destination (card) stays on `accountId`; funding source is in the note.
 */
export function applySmsCcPaymentTransfers(
  transactions: Transaction[],
  accounts: Account[],
): SmsCcPaymentTransferResult {
  const warnings: string[] = [];
  let expandedCount = 0;
  let unresolvedCount = 0;
  let warnedMissing = false;
  let warnedAmbiguous = false;

  const out = transactions.map((tx) => {
    const blob = `${tx.description || ''}\n${tx.note || ''}`;
    const cardId = String(tx.accountId || '').trim();
    const cardAccount = accounts.find((a) => a.id === cardId);
    const isSettlement =
      parseSmsKindFromNote(tx.note) === SMS_CC_PAYMENT_KIND ||
      smsLooksLikeCardSettlementCredit({
        text: blob,
        amount: Number(tx.amount),
        accountType: cardAccount?.type,
      });
    if (!isSettlement || !(Number(tx.amount) > 0)) return tx;

    const last4 =
      parseSmsCardLast4FromNote(tx.note) ??
      extractSmsCardLast4(blob) ??
      extractSmsCardLast4(String(tx.description || ''));
    // If routing missed the card, recover account from last-4 on Credit accounts.
    let effectiveCardId = cardId;
    let effectiveCardAccount = cardAccount;
    if (!effectiveCardId && last4) {
      const byLast4 = accounts.filter(
        (a) =>
          a.type === 'Credit' &&
          String(a.lastFourDigits || a.platformDetails?.cardLast4 || '').replace(/\D/g, '').slice(-4) ===
            last4,
      );
      if (byLast4.length === 1) {
        effectiveCardId = byLast4[0].id;
        effectiveCardAccount = byLast4[0];
      }
    }

    const resolved = resolveCcPaymentFundingAccount(accounts, {
      excludeAccountIds: effectiveCardId ? [effectiveCardId] : [],
    });
    const time = parseSmsTimeFromNote(tx.note);
    const cardLabel =
      effectiveCardAccount?.name ||
      (last4 ? `••••${last4}` : 'Credit card');

    if (!resolved.account) {
      unresolvedCount += 1;
      if (resolved.reason === 'ambiguous' && !warnedAmbiguous) {
        warnedAmbiguous = true;
        warnings.push(
          `Multiple funding accounts for card payments (${resolved.candidates.map((a) => a.name).join(', ')}). Set Cash role “Debt servicing” / “Bills payment” on one Checking/Savings account, or pick “Paid from” on each سداد row.`,
        );
      } else if (resolved.reason === 'none' && !warnedMissing) {
        warnedMissing = true;
        warnings.push(
          'Card payments (سداد) need a Checking/Savings funding account (not Physical cash). Assign “Paid from” on each سداد row before importing.',
        );
      }
      return {
        ...tx,
        accountId: effectiveCardId || tx.accountId,
        category: 'Transfer',
        type: 'income' as const,
        budgetCategory: undefined,
        description: String(tx.description || '').trim().startsWith('CC payment')
          ? tx.description
          : `CC payment · ${cardLabel}`,
        note: smsNoteWithCcPaymentMeta(tx.note, { last4, time, fundedFromAccountId: null }),
      };
    }

    expandedCount += 1;
    const fromName = resolved.account.name;
    return {
      ...tx,
      accountId: effectiveCardId || tx.accountId,
      category: 'Transfer',
      type: 'income' as const,
      budgetCategory: undefined,
      description: `CC payment ← ${fromName} · ${cardLabel}`,
      note: smsNoteWithCcPaymentMeta(tx.note, {
        last4,
        time,
        fundedFromAccountId: resolved.account.id,
      }),
    };
  });

  return { transactions: out, warnings, expandedCount, unresolvedCount };
}

/** True when this review row should import via addTransfer (funding → card). */
export function shouldImportSmsCcPaymentAsTransfer(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId'>,
): boolean {
  if (!isSmsCcPaymentTx(tx)) return false;
  if (!(Number(tx.amount) > 0)) return false;
  const fundedFrom = parseSmsCcFundedFromNote(tx.note);
  const cardId = String(tx.accountId || '').trim();
  return Boolean(fundedFrom && cardId && fundedFrom !== cardId);
}
