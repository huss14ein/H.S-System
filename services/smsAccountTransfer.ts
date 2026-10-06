/**
 * Local/internal bank transfer SMS (حوالة):
 * - Outgoing (صادرة) → debit source + credit destination via addTransfer (with fee).
 * - Incoming (واردة) → same ledger transfer via addTransfer; requires Received-from
 *   (or auto-pairs with a matching outgoing SMS in the same paste).
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
  smsTextLooksLikeAccountTransferIn,
  smsTextLooksLikeAccountTransferOut,
} from './smsBankTransferPatterns';

export const SMS_ACCOUNT_TRANSFER_KIND = 'account_transfer';
export const SMS_ACCOUNT_TRANSFER_IN_KIND = 'account_transfer_in';

/** Between own accounts (addTransfer) vs external payee/sender (expense / income). */
export type SmsAccountTransferScope = 'internal' | 'external';

export function isSmsAccountTransferTx(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  if (!(Number(tx.amount) < 0)) return false;
  if (/sms:kind=account_transfer\b/i.test(String(tx.note || ''))) return true;
  // Do not treat account_transfer_in as outgoing.
  if (/sms:kind=account_transfer_in\b/i.test(String(tx.note || ''))) return false;
  const blob = `${tx.description || ''}\n${tx.category || ''}\n${tx.note || ''}`;
  return smsTextLooksLikeAccountTransferOut(blob);
}

/** Incoming حوالة واردة — positive credit that must become an account-to-account transfer. */
export function isSmsAccountTransferInTx(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  if (!(Number(tx.amount) > 0)) return false;
  if (/sms:kind=account_transfer_in\b/i.test(String(tx.note || ''))) return true;
  if (/sms:kind=account_transfer\b/i.test(String(tx.note || ''))) return false;
  const blob = `${tx.description || ''}\n${tx.category || ''}\n${tx.note || ''}`;
  return smsTextLooksLikeAccountTransferIn(blob);
}

export function parseSmsAccountTransferToFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:transfer_to=([A-Za-z0-9_-]+)\b/i);
  return m?.[1] ? String(m[1]).trim() : null;
}

export function parseSmsAccountTransferFromFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:transfer_from=([A-Za-z0-9_-]+)\b/i);
  return m?.[1] ? String(m[1]).trim() : null;
}

export function parseSmsAccountTransferScopeFromNote(
  note: string | undefined,
): SmsAccountTransferScope | null {
  const m = String(note || '').match(/sms:xfer_scope=(internal|external)\b/i);
  if (!m?.[1]) return null;
  return m[1].toLowerCase() === 'external' ? 'external' : 'internal';
}

/**
 * Resolve whether a حوالة row is between own accounts or external.
 * Explicit `sms:xfer_scope` wins; otherwise counterparty meta ⇒ internal, else external.
 */
export function resolveSmsAccountTransferScope(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): SmsAccountTransferScope {
  const explicit = parseSmsAccountTransferScopeFromNote(tx.note);
  if (explicit) return explicit;
  if (isSmsAccountTransferInTx(tx)) {
    if (
      parseSmsAccountTransferFromFromNote(tx.note) ||
      isSmsAccountTransferInPaired(tx.note)
    ) {
      return 'internal';
    }
    return 'external';
  }
  if (isSmsAccountTransferTx(tx)) {
    if (parseSmsAccountTransferToFromNote(tx.note)) return 'internal';
    return 'external';
  }
  return 'external';
}

/** True when حوالة should import via addTransfer (not budgeted expense/income). */
export function isSmsAccountTransferInternal(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  if (!isSmsAccountTransferTx(tx) && !isSmsAccountTransferInTx(tx)) return false;
  return resolveSmsAccountTransferScope(tx) === 'internal';
}

/** External payee (expense) or external sender (income) — normal ledger row with budget. */
export function isSmsAccountTransferExternal(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  if (!isSmsAccountTransferTx(tx) && !isSmsAccountTransferInTx(tx)) return false;
  return resolveSmsAccountTransferScope(tx) === 'external';
}

/** True when this inbound leg was paired with an outgoing حوالة in the same paste. */
export function isSmsAccountTransferInPaired(note: string | undefined): boolean {
  return /sms:paired=1\b/i.test(String(note || ''));
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
    .replace(/\s*sms:transfer_from=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:paired=1\b/gi, '')
    .replace(/\s*sms:xfer_scope=(?:internal|external)\b/gi, '')
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
    scope?: SmsAccountTransferScope | null;
  },
): string | undefined {
  const without = String(existingNote || '')
    .replace(/\s*sms:transfer_to=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:to_card=\d{4}\b/gi, '')
    .replace(/\s*sms:fee=\d+(?:\.\d+)?\b/gi, '')
    .replace(/\s*sms:xfer_scope=(?:internal|external)\b/gi, '')
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
  const scope: SmsAccountTransferScope =
    opts.scope === 'internal' || opts.scope === 'external'
      ? opts.scope
      : transferTo
        ? 'internal'
        : (parseSmsAccountTransferScopeFromNote(existingNote) ?? 'external');
  const parts: string[] = [];
  if (base) parts.push(base);
  if (destLast4) parts.push(`sms:to_card=${destLast4}`);
  if (transferTo && scope === 'internal') parts.push(`sms:transfer_to=${transferTo}`);
  if (fee > 0) parts.push(`sms:fee=${fee}`);
  parts.push(`sms:xfer_scope=${scope}`);
  return parts.length ? parts.join(' ') : undefined;
}

export function smsNoteWithAccountTransferInMeta(
  existingNote: string | undefined,
  opts: {
    last4?: string | null;
    time?: string | null;
    transferFromAccountId?: string | null;
    paired?: boolean | null;
    scope?: SmsAccountTransferScope | null;
  },
): string | undefined {
  const without = String(existingNote || '')
    .replace(/\s*sms:transfer_from=[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\s*sms:paired=1\b/gi, '')
    .replace(/\s*sms:xfer_scope=(?:internal|external)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = smsNoteWithAtmMeta(without || undefined, {
    last4: opts.last4 ?? parseSmsCardLast4FromNote(existingNote),
    time: opts.time ?? parseSmsTimeFromNote(existingNote),
    kind: SMS_ACCOUNT_TRANSFER_IN_KIND,
    cashToAccountId: null,
  });
  const transferFrom =
    opts.transferFromAccountId != null
      ? String(opts.transferFromAccountId).trim() || null
      : parseSmsAccountTransferFromFromNote(existingNote);
  const paired =
    opts.paired != null ? Boolean(opts.paired) : isSmsAccountTransferInPaired(existingNote);
  const scope: SmsAccountTransferScope =
    opts.scope === 'internal' || opts.scope === 'external'
      ? opts.scope
      : transferFrom || paired
        ? 'internal'
        : (parseSmsAccountTransferScopeFromNote(existingNote) ?? 'external');
  const parts: string[] = [];
  if (base) parts.push(base);
  if (transferFrom && scope === 'internal') parts.push(`sms:transfer_from=${transferFrom}`);
  if (paired && scope === 'internal') parts.push('sms:paired=1');
  parts.push(`sms:xfer_scope=${scope}`);
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
          `Destination ••••${destLast4} matches multiple accounts (${resolved.candidates.map((a) => a.name).join(', ')}). Pick “Between my accounts” + Transfer to, or leave as External expense.`,
        );
      }
      // Unmatched destination defaults to external expense (budgetable), not a forced Transfer.
      const cleanDesc = beneficiary.replace(/^Transfer\s*(→[^·]*·?\s*|·\s*)?/i, '').trim() || beneficiary;
      return {
        ...tx,
        category: 'Other',
        type: 'expense' as const,
        description: cleanDesc,
        note: smsNoteWithAccountTransferMeta(tx.note, {
          last4,
          time,
          destLast4,
          transferToAccountId: null,
          feeAmount: fee,
          scope: 'external',
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
        scope: 'internal',
      }),
    };
  });

  return { transactions: out, warnings, expandedCount, unresolvedCount };
}

/**
 * After last-4 routing: mark incoming حوالة واردة rows as account_transfer_in.
 * Unpaired defaults to external income; pairing / Received-from sets internal.
 */
export function applySmsAccountTransferIns(
  transactions: Transaction[],
  _accounts: Account[],
): SmsAccountTransferResult {
  const warnings: string[] = [];
  let expandedCount = 0;
  let unresolvedCount = 0;

  const out = transactions.map((tx) => {
    const blob = `${tx.description || ''}\n${tx.note || ''}`;
    const alreadyKind = parseSmsKindFromNote(tx.note) === SMS_ACCOUNT_TRANSFER_IN_KIND;
    const isTransferIn =
      alreadyKind ||
      (Number(tx.amount) > 0 && smsTextLooksLikeAccountTransferIn(blob));
    if (!isTransferIn || !(Number(tx.amount) > 0)) return tx;

    const last4 = parseSmsCardLast4FromNote(tx.note);
    const time = parseSmsTimeFromNote(tx.note);
    const transferFrom = parseSmsAccountTransferFromFromNote(tx.note);
    const paired = isSmsAccountTransferInPaired(tx.note);
    const sender = String(tx.description || '').trim() || 'Transfer';
    const cleanSender = sender.replace(/^Transfer\s*(←[^·]*·?\s*|·\s*)?/i, '').trim() || sender;
    const scope: SmsAccountTransferScope =
      transferFrom || paired
        ? 'internal'
        : (parseSmsAccountTransferScopeFromNote(tx.note) ?? 'external');

    if (scope === 'internal' && !transferFrom && !paired) unresolvedCount += 1;
    else if (scope === 'internal') expandedCount += 1;

    if (scope === 'external') {
      return {
        ...tx,
        category: 'Income',
        type: 'income' as const,
        description: cleanSender,
        note: smsNoteWithAccountTransferInMeta(tx.note, {
          last4,
          time,
          transferFromAccountId: null,
          paired: false,
          scope: 'external',
        }),
      };
    }

    return {
      ...tx,
      category: 'Transfer',
      budgetCategory: undefined,
      type: 'income' as const,
      description: transferFrom
        ? `Transfer ← ${cleanSender}`
        : `Transfer · ${cleanSender}`,
      note: smsNoteWithAccountTransferInMeta(tx.note, {
        last4,
        time,
        transferFromAccountId: transferFrom,
        paired,
        scope: 'internal',
      }),
    };
  });

  return { transactions: out, warnings, expandedCount, unresolvedCount };
}

function accountLast4(account: Account | undefined): string | null {
  if (!account) return null;
  return normalizeCardLast4(
    account.lastFourDigits || account.platformDetails?.cardLast4 || null,
  );
}

/**
 * Pair outgoing + incoming حوالة SMS from the same paste so only one addTransfer runs.
 * Matches on date + principal amount + complementary accounts / destination last-4.
 */
export function pairSmsAccountTransferLegs(
  transactions: Transaction[],
  accounts: Account[],
): { transactions: Transaction[]; pairedCount: number } {
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const usedOut = new Set<number>();
  const usedIn = new Set<number>();
  let pairedCount = 0;

  const outIdx: number[] = [];
  const inIdx: number[] = [];
  transactions.forEach((tx, i) => {
    if (isSmsAccountTransferTx(tx) && Number(tx.amount) < 0) outIdx.push(i);
    if (isSmsAccountTransferInTx(tx) && Number(tx.amount) > 0) inIdx.push(i);
  });

  const next = transactions.slice();

  for (const i of inIdx) {
    if (usedIn.has(i)) continue;
    const inTx = next[i];
    const inAmt = Math.abs(Number(inTx.amount) || 0);
    const inDate = String(inTx.date || '').slice(0, 10);
    const inAcct = String(inTx.accountId || '').trim();
    const inLast4 = accountLast4(byId.get(inAcct)) ?? parseSmsCardLast4FromNote(inTx.note);

    const candidates = outIdx.filter((j) => {
      if (usedOut.has(j)) return false;
      const outTx = next[j];
      if (String(outTx.date || '').slice(0, 10) !== inDate) return false;
      if (Math.abs(smsAccountTransferPrincipalAmount(outTx) - inAmt) > 0.02) return false;
      const outAcct = String(outTx.accountId || '').trim();
      if (outAcct && inAcct && outAcct === inAcct) return false;

      const transferTo = parseSmsAccountTransferToFromNote(outTx.note);
      const destLast4 = parseSmsTransferDestLast4FromNote(outTx.note);
      const transferFrom = parseSmsAccountTransferFromFromNote(inTx.note);

      if (transferTo && inAcct && transferTo === inAcct) return true;
      if (destLast4 && inLast4 && destLast4 === inLast4) return true;
      if (transferFrom && outAcct && transferFrom === outAcct) return true;
      // Unique same-day same-amount complement across remaining unmatched legs.
      return Boolean(outAcct && inAcct && outAcct !== inAcct);
    });

    // Prefer strong last-4 / transfer_to matches; otherwise require uniqueness.
    let j = candidates.find((idx) => {
      const outTx = next[idx];
      const transferTo = parseSmsAccountTransferToFromNote(outTx.note);
      const destLast4 = parseSmsTransferDestLast4FromNote(outTx.note);
      return (
        (transferTo && inAcct && transferTo === inAcct) ||
        (destLast4 && inLast4 && destLast4 === inLast4)
      );
    });
    if (j == null && candidates.length === 1) j = candidates[0];
    if (j == null) continue;

    const outTx = next[j];
    const outAcct = String(outTx.accountId || '').trim();
    const transferTo = parseSmsAccountTransferToFromNote(outTx.note);
    const transferFrom = parseSmsAccountTransferFromFromNote(inTx.note);
    const resolvedTo = inAcct || transferTo || null;
    const resolvedFrom = outAcct || transferFrom || null;

    next[j] = {
      ...outTx,
      category: 'Transfer',
      budgetCategory: undefined,
      note: smsNoteWithAccountTransferMeta(outTx.note, {
        transferToAccountId: resolvedTo,
        scope: 'internal',
      }),
      description:
        resolvedTo && byId.get(resolvedTo)
          ? `Transfer → ${byId.get(resolvedTo)!.name}${
              outTx.description && !/^Transfer\b/i.test(outTx.description)
                ? ` · ${outTx.description.replace(/^Transfer\s*(→[^·]*·?\s*)?/i, '').trim()}`
                : ''
            }`
          : outTx.description,
    };

    next[i] = {
      ...inTx,
      category: 'Transfer',
      budgetCategory: undefined,
      note: smsNoteWithAccountTransferInMeta(inTx.note, {
        transferFromAccountId: resolvedFrom,
        paired: Boolean(resolvedFrom && resolvedTo),
        scope: 'internal',
      }),
      description:
        resolvedFrom && byId.get(resolvedFrom)
          ? `Transfer ← ${byId.get(resolvedFrom)!.name}${
              inTx.description && !/^Transfer\b/i.test(inTx.description)
                ? ` · ${inTx.description.replace(/^Transfer\s*(←[^·]*·?\s*|·\s*)?/i, '').trim()}`
                : ''
            }`
          : inTx.description,
    };

    usedOut.add(j);
    usedIn.add(i);
    if (resolvedFrom && resolvedTo) pairedCount += 1;
  }

  return { transactions: next, pairedCount };
}

/**
 * When an inbound row is paired and its matching outbound is also selected for import,
 * skip the inbound (outbound writes the single addTransfer).
 */
export function shouldSkipPairedSmsAccountTransferIn(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId' | 'date'>,
  allRows: Array<Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId' | 'date'>>,
  selectedIndices: Set<number>,
  rowIndex: number,
): boolean {
  if (!isSmsAccountTransferInTx(tx)) return false;
  if (!isSmsAccountTransferInPaired(tx.note)) return false;
  const fromId = parseSmsAccountTransferFromFromNote(tx.note);
  const toId = String(tx.accountId || '').trim();
  const inAmt = Math.abs(Number(tx.amount) || 0);
  const inDate = String(tx.date || '').slice(0, 10);
  if (!fromId || !toId) return false;

  for (let j = 0; j < allRows.length; j++) {
    if (j === rowIndex) continue;
    if (!selectedIndices.has(j)) continue;
    const other = allRows[j];
    if (!isSmsAccountTransferTx(other) || !(Number(other.amount) < 0)) continue;
    if (String(other.date || '').slice(0, 10) !== inDate) continue;
    if (Math.abs(smsAccountTransferPrincipalAmount(other) - inAmt) > 0.02) continue;
    const otherFrom = String(other.accountId || '').trim();
    const otherTo = parseSmsAccountTransferToFromNote(other.note);
    if (otherFrom === fromId && (otherTo === toId || !otherTo)) return true;
  }
  return false;
}

/** True when this review row should import via addTransfer (source → destination). */
export function shouldImportSmsAccountAsTransfer(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId'>,
): boolean {
  if (!isSmsAccountTransferTx(tx)) return false;
  if (!(Number(tx.amount) < 0)) return false;
  if (resolveSmsAccountTransferScope(tx) !== 'internal') return false;
  const toId = parseSmsAccountTransferToFromNote(tx.note);
  const fromId = String(tx.accountId || '').trim();
  return Boolean(toId && fromId && toId !== fromId);
}

/** True when inbound حوالة should import via addTransfer (Received-from → this account). */
export function shouldImportSmsAccountTransferInAsTransfer(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId'>,
): boolean {
  if (!isSmsAccountTransferInTx(tx)) return false;
  if (!(Number(tx.amount) > 0)) return false;
  if (resolveSmsAccountTransferScope(tx) !== 'internal') return false;
  const fromId = parseSmsAccountTransferFromFromNote(tx.note);
  const toId = String(tx.accountId || '').trim();
  return Boolean(fromId && toId && fromId !== toId);
}
