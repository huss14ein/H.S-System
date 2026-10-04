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
    /card\s*(?:ending|no\.?|#|number)?\s*[:\-]?\s*(\d{4})(?!\d)/i,
    /(?:ending|آخر\s*4)\s*[:\-]?\s*(\d{4})(?!\d)/i,
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

/** Clock time from SMS note (`sms:time=HH:mm`) for same-day newest-first ordering. */
export function parseSmsTimeFromNote(note: string | undefined): string | null {
  const m = String(note || '').match(/sms:time=(\d{1,2}):(\d{2})\b/i);
  if (!m) return null;
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Minutes since midnight for `sms:time=HH:mm`, or -1 when absent. */
export function smsTimeMinutesFromNote(note: string | undefined): number {
  const t = parseSmsTimeFromNote(note);
  if (!t) return -1;
  const [hh, mm] = t.split(':').map((x) => parseInt(x, 10));
  return hh * 60 + mm;
}

export function smsNoteWithMeta(
  existingNote: string | undefined,
  opts: { last4?: string | null; time?: string | null },
): string | undefined {
  let without = String(existingNote || '')
    .replace(/\s*sms:card=\d{4}\b/gi, '')
    .replace(/\s*sms:time=\d{1,2}:\d{2}\b/gi, '')
    .trim();
  const last4 = normalizeCardLast4(opts.last4 ?? null);
  const time = opts.time ? parseSmsTimeFromNote(`sms:time=${opts.time}`) : parseSmsTimeFromNote(existingNote);
  const parts: string[] = [];
  if (without) parts.push(without);
  if (last4) parts.push(`sms:card=${last4}`);
  if (time) parts.push(`sms:time=${time}`);
  return parts.length ? parts.join(' ') : undefined;
}

export function smsNoteWithCardLast4(existingNote: string | undefined, last4: string | null): string | undefined {
  return smsNoteWithMeta(existingNote, { last4, time: parseSmsTimeFromNote(existingNote) });
}

export type SmsAccountRoutingResult = {
  transactions: Transaction[];
  warnings: string[];
  unmatchedLast4: string[];
  matchedCount: number;
};

/**
 * Assign each SMS row to the account whose last-4 matches the SMS card mask.
 * Uses `fallbackAccountId` when no unique match; when fallback is empty, leaves accountId blank
 * so the review table can require an explicit assignment before import.
 */
export function applySmsAccountRouting(
  transactions: Transaction[],
  accounts: Account[],
  fallbackAccountId: string,
): SmsAccountRoutingResult {
  const warnings: string[] = [];
  const unmatched = new Set<string>();
  let matchedCount = 0;
  let missingCardLast4Count = 0;
  const cashAccounts = accounts.filter((a) => a.type !== 'Investment');
  const fallback = String(fallbackAccountId || '').trim();

  const resolveFallbackAccountId = (tx: Transaction): string => {
    const existing = String(tx.accountId || '').trim();
    // Parser seeds rows with the fallback id; treat that as unset so last-4 can win.
    if (existing && existing !== fallback) return existing;
    return fallback;
  };

  const routed = transactions.map((tx) => {
    const last4 =
      parseSmsCardLast4FromNote(tx.note) ??
      extractSmsCardLast4(`${tx.description}\n${tx.note || ''}`);
    if (!last4) {
      const accountId = resolveFallbackAccountId(tx);
      if (!accountId) missingCardLast4Count += 1;
      return { ...tx, accountId };
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
        fallback
          ? `Card ••••${last4} matches multiple accounts (${matches.map((a) => a.name).join(', ')}); using the fallback account.`
          : `Card ••••${last4} matches multiple accounts (${matches.map((a) => a.name).join(', ')}); assign the account in the review table.`,
      );
    } else {
      unmatched.add(last4);
    }
    return {
      ...tx,
      accountId: resolveFallbackAccountId(tx),
      note: smsNoteWithCardLast4(tx.note, last4),
    };
  });

  if (missingCardLast4Count > 0 && !fallback) {
    warnings.push(
      `${missingCardLast4Count} row(s) had no card last-4 in the SMS. Choose a fallback account or assign each row in review.`,
    );
  }

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

  const missingAccountCount = routed.filter((t) => !String(t.accountId || '').trim()).length;
  if (missingAccountCount > 0) {
    warnings.push(
      `${missingAccountCount} row(s) have no account assigned. Set Card last-4 on Accounts, choose a fallback account, or pick an account per row before importing.`,
    );
  }

  return { transactions: routed, warnings, unmatchedLast4, matchedCount };
}
