import type { Account, Liability } from '../types';

const DRIFT_EPS = 0.02;

/** Credit accounts that have a linked Credit Card liability (authoritative debt in `liabilities.amount`). */
export function getCreditCardLinkedAccountIds(liabilities: Liability[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!liabilities?.length) return out;
  for (const l of liabilities) {
    if (l.type !== 'Credit Card') continue;
    const id = (l as Liability & { accountId?: string }).accountId ?? (l as { account_id?: string }).account_id;
    if (id && String(id).trim() !== '') out.add(String(id));
  }
  return out;
}

export function findCreditCardLiabilityForAccount(
  liabilities: Liability[] | undefined,
  creditAccountId: string,
): Liability | undefined {
  if (!liabilities?.length) return undefined;
  return liabilities.find(
    (l) => l.type === 'Credit Card' && ((l as Liability & { accountId?: string }).accountId ?? (l as { account_id?: string }).account_id) === creditAccountId,
  );
}

export function creditCardMirrorDrift(liability: Liability | undefined, creditAccount: Account | undefined): number | null {
  if (!liability || !creditAccount || creditAccount.type !== 'Credit') return null;
  return (Number(creditAccount.balance) || 0) - (Number(liability.amount) || 0);
}

export function creditCardMirrorMatches(liability: Liability | undefined, creditAccount: Account | undefined): boolean {
  const d = creditCardMirrorDrift(liability, creditAccount);
  if (d == null) return true;
  return Math.abs(d) <= DRIFT_EPS;
}
