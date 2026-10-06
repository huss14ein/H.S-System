/**
 * Outgoing local/internal bank transfer SMS (حوالة محلية/داخلية صادرة)
 * → debit source account + credit destination account via addTransfer (with fee).
 */
import type { Account, Transaction } from '../types';
import {
  findAccountsByCardLast4,
  normalizeCardLast4,
  parseSmsCardLast4FromNote,
  parseSmsTimeFromNote,
} from './smsImportRouting';
import {
  parseSmsKindFromNote,
  smsNoteWithAtmMeta,
  stripSmsAtmMeta,
} from './smsAtmCashTransfer';
import {
  extractSmsTransferDestinationLast4,
  extractSmsTransferFeeAmount,
  smsTextLooksLikeAccountTransferOut,
} from './smsBankTransferPatterns';

export const SMS_ACCOUNT_TRANSFER_KIND = 'account_transfer';

export function isSmsAccountTransferTx(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  if (!(Number(tx.amount) < 0)) return false;
  if (/sms:kind=account_transfer\b/i.test(String(tx.note || ''))) return true;
  const blob = `${tx.description || ''}\n${tx.category || ''}\n${tx.note || ''}`;
  return smsTextLooksLikeAccountTransferOut(blob);
}

export function parseSmsAccountTransferToFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:transfer_to=([A-Za-z0-9_-]+)\b/i);
  return m?.[1] ? String(m[1]).trim() : null;
}

export function parseSmsTransferDestLast4FromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:to_card=(\d{4})\b/i);
  return m ? normalizeCardLast4(m[1]) : null;
}

export function parseSmsTransferFeeFromNote(note: string | undefined): number {
  const m = String(note || '').match(/sms:fee=(\d+(?:\.\d+)?)\b/i);
  if (!m?.[1]) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Principal amount for addTransfer when SMS amount includes fee. */
export function smsAccountTransferPrincipalAmount(tx: Pick<Transaction, 'amount' | 'note'>): number {
  const abs = Math.abs(Number(tx.amount) || 0);
  const fee = parseSmsTransferFeeFromNote(tx.note);
  if (fee > 0 && fee < abs) return abs - fee;
  return abs;
}

export function stripSmsAccountTransferMeta(note: string | undefined): string {
  return stripSmsAtmMeta(note)
    .replace(/\s*sms:transfer_to=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:to_card=\d{4}\b/gi, '')
    .replace(/\s*sms:fee=\d+(?:\.\d+)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function smsNoteWithAccountTransferMeta(
  existingNote: string | undefined,
  opts: {
    last4?: string | null;
    time?: string | null;
    destLast4?: string | null;
    transferToAccountId?: string | null;
    feeAmount?: number | null;
  },
): string | undefined {
  const without = String(existingNote || '')
    .replace(/\s*sms:transfer_to=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:to_card=\d{4}\b/gi, '')
    .replace(/\s*sms:fee=\d+(?:\.\d+)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = smsNoteWithAtmMeta(without || undefined, {
    last4: opts.last4 ?? parseSmsCardLast4FromNote(existingNote),
    time: opts.time ?? parseSmsTimeFromNote(existingNote),
    kind: SMS_ACCOUNT_TRANSFER_KIND,
    cashToAccountId: null,
  });
  const destLast4 =
    opts.destLast4 != null
      ? normalizeCardLast4(opts.destLast4)
      : parseSmsTransferDestLast4FromNote(existingNote);
  const transferTo =
    opts.transferToAccountId != null
      ? String(opts.transferToAccountId).trim() || null
      : parseSmsAccountTransferToFromNote(existingNote);
  const fee =
    opts.feeAmount != null && Number.isFinite(Number(opts.feeAmount))
      ? Math.max(0, Number(opts.feeAmount))
      : parseSmsTransferFeeFromNote(existingNote);
  const parts: string[] = [];
  if (base) parts.push(base);
  if (destLast4) parts.push(`sms:to_card=${destLast4}`);
  if (transferTo) parts.push(`sms:transfer_to=${transferTo}`);
  if (fee > 0) parts.push(`sms:fee=${fee}`);
  return parts.length ? parts.join(' ') : undefined;
}

export function isEligibleAccountTransferDestination(
  account: Pick<Account, 'id' | 'type' | 'accountRole'> | null | undefined,
): boolean {
  if (!account) return false;
  if (account.type === 'Investment') return false;
  return account.type === 'Checking' || account.type === 'Savings' || account.type === 'Credit';
}

/**
 * Resolve destination by SMS `لـXXXX` last-4 among non-investment accounts.
 * Never returns the source account id.
 */
export function resolveAccountTransferDestination(
  accounts: Account[],
  destLast4: string | null | undefined,
  opts?: { excludeAccountIds?: Iterable<string> },
): { account: Account | null; candidates: Account[]; reason: 'last4' | 'none' | 'ambiguous' } {
  const exclude = new Set(
    [...(opts?.excludeAccountIds ?? [])].map((id) => String(id || '').trim()).filter(Boolean),
  );
  const n = normalizeCardLast4(destLast4);
  if (!n) return { account: null, candidates: [], reason: 'none' };

  const eligible = findAccountsByCardLast4(accounts, n).filter(
    (a) => isEligibleAccountTransferDestination(a) && !exclude.has(String(a.id || '').trim()),
  );
  if (eligible.length === 1) return { account: eligible[0], candidates: eligible, reason: 'last4' };
  if (eligible.length > 1) return { account: null, candidates: eligible, reason: 'ambiguous' };
  return { account: null, candidates: [], reason: 'none' };
}

export type SmsAccountTransferResult = {
  transactions: Transaction[];
  warnings: string[];
  expandedCount: number;
  unresolvedCount: number;
};

/**
 * After last-4 routing: mark outgoing حوالة rows and attach `sms:transfer_to` when the
 * destination last-4 uniquely matches one of the user's accounts.
 */
export function applySmsAccountTransfers(
  transactions: Transaction[],
  accounts: Account[],
): SmsAccountTransferResult {
  const warnings: string[] = [];
  let expandedCount = 0;
  let unresolvedCount = 0;
  let warnedAmbiguous = false;

  const out = transactions.map((tx) => {
    const blob = `${tx.description || ''}\n${tx.note || ''}`;
    const alreadyKind = parseSmsKindFromNote(tx.note) === SMS_ACCOUNT_TRANSFER_KIND;
    const isTransferOut =
      alreadyKind ||
      (Number(tx.amount) < 0 && smsTextLooksLikeAccountTransferOut(blob));
    if (!isTransferOut || !(Number(tx.amount) < 0)) return tx;

    const sourceId = String(tx.accountId || '').trim();
    const last4 = parseSmsCardLast4FromNote(tx.note);
    const time = parseSmsTimeFromNote(tx.note);
    const destLast4 =
      parseSmsTransferDestLast4FromNote(tx.note) ?? extractSmsTransferDestinationLast4(blob);
    const feeFromNote = parseSmsTransferFeeFromNote(tx.note);
    const fee = feeFromNote > 0 ? feeFromNote : extractSmsTransferFeeAmount(blob);

    const resolved = resolveAccountTransferDestination(accounts, destLast4, {
      excludeAccountIds: sourceId ? [sourceId] : [],
    });

    const beneficiary = String(tx.description || '').trim() || 'Transfer';

    if (!resolved.account) {
      unresolvedCount += 1;
      if (resolved.reason === 'ambiguous' && !warnedAmbiguous) {
        warnedAmbiguous = true;
        warnings.push(
          `Destination ••••${destLast4} matches multiple accounts (${resolved.candidates.map((a) => a.name).join(', ')}). Pick “Transfer to” on each حوالة row.`,
        );
      }
      // External / unmatched destination: still Transfer (no budget); import as single row unless user picks a to-account.
      return {
        ...tx,
        category: 'Transfer',
        budgetCategory: undefined,
        description: beneficiary.startsWith('Transfer')
          ? beneficiary
          : `Transfer · ${beneficiary}`,
        note: smsNoteWithAccountTransferMeta(tx.note, {
          last4,
          time,
          destLast4,
          transferToAccountId: null,
          feeAmount: fee,
        }),
      };
    }

    expandedCount += 1;
    const toName = resolved.account.name;
    return {
      ...tx,
      category: 'Transfer',
      budgetCategory: undefined,
      description: `Transfer → ${toName}${beneficiary && !/^Transfer\b/i.test(beneficiary) ? ` · ${beneficiary}` : ''}`,
      note: smsNoteWithAccountTransferMeta(tx.note, {
        last4,
        time,
        destLast4,
        transferToAccountId: resolved.account.id,
        feeAmount: fee,
      }),
    };
  });

  return { transactions: out, warnings, expandedCount, unresolvedCount };
}

/** True when this review row should import via addTransfer (source → destination). */
export function shouldImportSmsAccountAsTransfer(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId'>,
): boolean {
  if (!isSmsAccountTransferTx(tx)) return false;
  if (!(Number(tx.amount) < 0)) return false;
  const toId = parseSmsAccountTransferToFromNote(tx.note);
  const fromId = String(tx.accountId || '').trim();
  return Boolean(toId && fromId && toId !== fromId);
}
