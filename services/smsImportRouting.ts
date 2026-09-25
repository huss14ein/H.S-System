/**
 * Card last-4 routing for bank SMS imports — match بطاقة/عبر/من masks to accounts.
 */
import type { Account, Transaction } from '../types';

export function normalizeCardLast4(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

/** Read last-4 from Account (top-level or platform_details.cardLast4). */
export function getAccountCardLast4(account: Pick<Account, 'lastFourDigits' | 'platformDetails'> | null | undefined): string | null {
  if (!account) return null;
  return normalizeCardLast4(account.lastFourDigits ?? account.platformDetails?.cardLast4 ?? null);
}

/** Persist last-4 into platformDetails without dropping existing investment metadata. */
export function withAccountCardLast4(
  platformDetails: Account['platformDetails'] | undefined,
  lastFourDigits: string | null | undefined,
): Account['platformDetails'] | undefined {
  const normalized = normalizeCardLast4(lastFourDigits);
  const base = platformDetails ?? { features: [], assetTypes: [], fees: '' };
  if (!normalized) {
    if (!platformDetails) return undefined;
    const { cardLast4: _omit, ...rest } = base as Account['platformDetails'] & { cardLast4?: string };
    return Object.keys(rest).length || (rest.features?.length ?? 0) || (rest.assetTypes?.length ?? 0) || rest.fees
      ? { ...rest, features: rest.features ?? [], assetTypes: rest.assetTypes ?? [], fees: rest.fees ?? '' }
      : undefined;
  }
  return { ...base, features: base.features ?? [], assetTypes: base.assetTypes ?? [], fees: base.fees ?? '', cardLast4: normalized };
}

/**
 * Extract card/account last-4 from a single SMS block.
 * Supports: بطاقة:7365, عبر:8529, عبر7365, من3138, *3282
 */
export function extractSmsCardLast4(block: string): string | null {
  const text = String(block || '');
  const patterns = [
    /بطاقة\s*[:\-]?\s*(\d{4})(?!\d)/,
    /عبر\s*[:\-]?\s*(\d{4})(?!\d)/,
    /من\s*[:\-]?\s*(\d{4})(?!\d)/,
    /\*(\d{4})(?!\d)/,
    /card\s*(?:ending|no\.?|#)?\s*[:\-]?\s*(\d{4})(?!\d)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return normalizeCardLast4(m[1]);
  }
  return null;
}

export function findAccountsByCardLast4(accounts: Account[], last4: string): Account[] {
  const n = normalizeCardLast4(last4);
  if (!n) return [];
  return accounts.filter((a) => a.type !== 'Investment' && getAccountCardLast4(a) === n);
}

export function parseSmsCardLast4FromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:card=(\d{4})\b/i);
  return m ? normalizeCardLast4(m[1]) : null;
}

export function smsNoteWithCardLast4(existingNote: string | undefined, last4: string | null): string | undefined {
  const without = String(existingNote || '')
    .replace(/\s*sms:card=\d{4}\b/gi, '')
    .trim();
  if (!last4) return without || undefined;
  return without ? `${without} sms:card=${last4}` : `sms:card=${last4}`;
}

export type SmsAccountRoutingResult = {
  transactions: Transaction[];
  warnings: string[];
  unmatchedLast4: string[];
  matchedCount: number;
};

/**
 * Assign each SMS row to the account whose last-4 matches the SMS card mask.
 * Falls back to `fallbackAccountId` when no match (or multiple matches → warning + fallback).
 */
export function applySmsAccountRouting(
  transactions: Transaction[],
  accounts: Account[],
  fallbackAccountId: string,
): SmsAccountRoutingResult {
  const warnings: string[] = [];
  const unmatched = new Set<string>();
  let matchedCount = 0;
  const cashAccounts = accounts.filter((a) => a.type !== 'Investment');

  const routed = transactions.map((tx) => {
    const last4 =
      parseSmsCardLast4FromNote(tx.note) ??
      extractSmsCardLast4(`${tx.description}\n${tx.note || ''}`);
    if (!last4) {
      return { ...tx, accountId: tx.accountId || fallbackAccountId };
    }

    const matches = findAccountsByCardLast4(cashAccounts, last4);
    if (matches.length === 1) {
      matchedCount += 1;
      return {
        ...tx,
        accountId: matches[0].id,
        note: smsNoteWithCardLast4(tx.note, last4),
      };
    }
    if (matches.length > 1) {
      warnings.push(
        `Card ••••${last4} matches multiple accounts (${matches.map((a) => a.name).join(', ')}); using the selected account.`,
      );
    } else {
      unmatched.add(last4);
    }
    return {
      ...tx,
      accountId: tx.accountId || fallbackAccountId,
      note: smsNoteWithCardLast4(tx.note, last4),
    };
  });

  const unmatchedLast4 = [...unmatched];
  if (unmatchedLast4.length) {
    warnings.push(
      `No account last-4 configured for card(s) ${unmatchedLast4.map((x) => `••••${x}`).join(', ')}. Set Card last-4 on Accounts, or assign the account in the review table.`,
    );
  }

  const distinctCards = new Set(
    routed
      .map((t) => parseSmsCardLast4FromNote(t.note))
      .filter((x): x is string => Boolean(x)),
  );
  if (distinctCards.size > 1) {
    warnings.push(
      `This paste includes ${distinctCards.size} different cards (${[...distinctCards].map((x) => `••••${x}`).join(', ')}). Review each row’s account before importing.`,
    );
  }

  return { transactions: routed, warnings, unmatchedLast4, matchedCount };
}
