/**
 * ATM cash withdrawals from bank SMS → debit source card/account + credit physical cash.
 */
import type { Account, Transaction } from '../types';
import {
  parseSmsCardLast4FromNote,
  parseSmsTimeFromNote,
  smsNoteWithMeta,
} from './smsImportRouting';
import { smsTextLooksLikeAtmWithdrawal } from './smsBankTransferPatterns';

const ATM_KIND = 'atm';

const PHYSICAL_CASH_NAME_RE =
  /(?:^|\b)(?:cash(?:\s+on\s+hand)?|wallet|petty\s*cash|نقد(?:ية|\s*في\s*اليد)?|محفظة(?:\s*نقدية)?|كاش)(?:\b|$)/i;

export function isSmsAtmWithdrawalTx(tx: Pick<Transaction, 'note' | 'description' | 'category'>): boolean {
  if (/sms:kind=atm\b/i.test(String(tx.note || ''))) return true;
  const blob = `${tx.description || ''}\n${tx.category || ''}\n${tx.note || ''}`;
  return smsTextLooksLikeAtmWithdrawal(blob);
}

export function parseSmsAtmCashToFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:cash_to=([A-Za-z0-9_-]+)\b/i);
  return m?.[1] ? String(m[1]).trim() : null;
}

export function parseSmsKindFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:kind=([a-z0-9_-]+)\b/i);
  return m?.[1] ? String(m[1]).trim().toLowerCase() : null;
}

/** Strip SMS transfer meta tokens while preserving free-form note text. */
export function stripSmsAtmMeta(note: string | undefined): string {
  return String(note || '')
    .replace(/\s*sms:kind=[a-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:cash_to=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:funded_from=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:transfer_to=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:transfer_from=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:paired=1\b/gi, '')
    .replace(/\s*sms:to_card=\d{4}\b/gi, '')
    .replace(/\s*sms:fee=\d+(?:\.\d+)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alias — strips ATM + CC-payment transfer meta. */
export const stripSmsTransferMeta = stripSmsAtmMeta;

export function smsNoteWithAtmMeta(
  existingNote: string | undefined,
  opts: {
    last4?: string | null;
    time?: string | null;
    kind?: string | null;
    cashToAccountId?: string | null;
  },
): string | undefined {
  const base = smsNoteWithMeta(stripSmsAtmMeta(existingNote), {
    last4: opts.last4 ?? parseSmsCardLast4FromNote(existingNote),
    time: opts.time ?? parseSmsTimeFromNote(existingNote),
  });
  const parts: string[] = [];
  if (base) parts.push(base);
  const kind = opts.kind != null ? String(opts.kind).trim().toLowerCase() : parseSmsKindFromNote(existingNote);
  const cashTo =
    opts.cashToAccountId != null
      ? String(opts.cashToAccountId).trim() || null
      : parseSmsAtmCashToFromNote(existingNote);
  if (kind) parts.push(`sms:kind=${kind}`);
  if (cashTo) parts.push(`sms:cash_to=${cashTo}`);
  return parts.length ? parts.join(' ') : undefined;
}

export function isEligiblePhysicalCashAccount(
  account: Pick<Account, 'id' | 'type' | 'name' | 'accountRole'> | null | undefined,
): boolean {
  if (!account) return false;
  if (account.type !== 'Checking' && account.type !== 'Savings') return false;
  return true;
}

/**
 * Prefer an account marked `physical_cash`, then name heuristics (Cash / نقد / Wallet).
 * Never returns an excluded id (e.g. the ATM source card).
 */
export function resolvePhysicalCashAccount(
  accounts: Account[],
  opts?: { excludeAccountIds?: Iterable<string> },
): { account: Account | null; candidates: Account[]; reason: 'role' | 'name' | 'none' | 'ambiguous' } {
  const exclude = new Set(
    [...(opts?.excludeAccountIds ?? [])].map((id) => String(id || '').trim()).filter(Boolean),
  );
  const eligible = accounts.filter(
    (a) => isEligiblePhysicalCashAccount(a) && !exclude.has(String(a.id || '').trim()),
  );

  const byRole = eligible.filter((a) => a.accountRole === 'physical_cash');
  if (byRole.length === 1) return { account: byRole[0], candidates: byRole, reason: 'role' };
  if (byRole.length > 1) return { account: null, candidates: byRole, reason: 'ambiguous' };

  const byName = eligible.filter((a) => PHYSICAL_CASH_NAME_RE.test(String(a.name || '')));
  if (byName.length === 1) return { account: byName[0], candidates: byName, reason: 'name' };
  if (byName.length > 1) return { account: null, candidates: byName, reason: 'ambiguous' };

  return { account: null, candidates: [], reason: 'none' };
}

export type SmsAtmCashTransferResult = {
  transactions: Transaction[];
  warnings: string[];
  expandedCount: number;
  unresolvedCount: number;
};

/**
 * After last-4 routing: mark ATM withdrawals and attach `sms:cash_to` when a physical cash
 * account can be resolved. Source account stays on the debiting card/account.
 */
export function applySmsAtmCashTransfers(
  transactions: Transaction[],
  accounts: Account[],
): SmsAtmCashTransferResult {
  const warnings: string[] = [];
  let expandedCount = 0;
  let unresolvedCount = 0;
  let warnedMissing = false;
  let warnedAmbiguous = false;

  const out = transactions.map((tx) => {
    if (!isSmsAtmWithdrawalTx(tx)) return tx;
    if (!(Number(tx.amount) < 0)) return tx;

    const sourceId = String(tx.accountId || '').trim();
    const resolved = resolvePhysicalCashAccount(accounts, {
      excludeAccountIds: sourceId ? [sourceId] : [],
    });

    const last4 = parseSmsCardLast4FromNote(tx.note);
    const time = parseSmsTimeFromNote(tx.note);
    const branch = String(tx.description || '').trim() || 'ATM';

    if (!resolved.account) {
      unresolvedCount += 1;
      if (resolved.reason === 'ambiguous' && !warnedAmbiguous) {
        warnedAmbiguous = true;
        warnings.push(
          `Multiple cash accounts found (${resolved.candidates.map((a) => a.name).join(', ')}). Set Cash role to “Physical cash / wallet” on one account, or pick the cash destination on each ATM row.`,
        );
      } else if (resolved.reason === 'none' && !warnedMissing) {
        warnedMissing = true;
        warnings.push(
          'ATM withdrawals need a Cash account (Checking/Savings named Cash/نقد, or Cash role “Physical cash / wallet”). Assign the cash destination on each ATM row before importing.',
        );
      }
      return {
        ...tx,
        category: 'Transfer',
        description: branch.startsWith('ATM') ? branch : `ATM · ${branch}`,
        note: smsNoteWithAtmMeta(tx.note, { last4, time, kind: ATM_KIND, cashToAccountId: null }),
      };
    }

    expandedCount += 1;
    const cashName = resolved.account.name;
    return {
      ...tx,
      category: 'Transfer',
      description: `ATM → ${cashName}${branch && !/^ATM\b/i.test(branch) ? ` · ${branch}` : ''}`,
      note: smsNoteWithAtmMeta(tx.note, {
        last4,
        time,
        kind: ATM_KIND,
        cashToAccountId: resolved.account.id,
      }),
    };
  });

  return { transactions: out, warnings, expandedCount, unresolvedCount };
}

/** True when this review row should import via addTransfer (source → cash). */
export function shouldImportSmsAtmAsTransfer(tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>): boolean {
  if (!isSmsAtmWithdrawalTx(tx)) return false;
  if (!(Number(tx.amount) < 0)) return false;
  return Boolean(parseSmsAtmCashToFromNote(tx.note));
}
