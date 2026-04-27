import type { Account, Transaction } from '../types';
import { toSAR } from '../utils/currencyMath';
import { transactionNetForAccount } from './dataQuality/accountReconciliation';
import { evaluateHawlEligibility, type HawlEligibility } from './zakatHawl';

export type ZakatCashLotDetail = {
  /** ISO date or null when opening balance cannot be dated */
  lotDate: string | null;
  /** Remaining amount in account book currency */
  amountBook: number;
  grossValueSar: number;
  zakatableValueSar: number;
  hawlEligible: boolean;
  hawlLabel: string;
};

export type ZakatCashLine = {
  accountId: string;
  accountName: string;
  currency: 'USD' | 'SAR';
  /** Current balance used for gross (book currency) */
  balanceBook: number;
  grossValueSar: number;
  zakatableValueSar: number;
  /** Combined status for the account row */
  summaryLabel: string;
  lots: ZakatCashLotDetail[];
};

type InternalLot = { ymd: string | null; amount: number };

function cmpTx(a: Transaction, b: Transaction): number {
  const da = String(a.date ?? '').slice(0, 10);
  const db = String(b.date ?? '').slice(0, 10);
  if (da !== db) return da < db ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

function consumeFifo(lots: InternalLot[], debit: number): void {
  let rem = Math.max(0, debit);
  while (rem > 1e-9 && lots.length > 0) {
    const first = lots[0]!;
    const take = Math.min(first.amount, rem);
    first.amount -= take;
    rem -= take;
    if (first.amount <= 1e-9) lots.shift();
  }
}

/**
 * Checking/Savings cash: FIFO layers from transaction history + implied opening balance.
 * Only amounts that complete a lunar hawl (~354d) from the deposit (lot) date count toward Zakat.
 * Opening balance without a historical date is never counted (strict) until you backfill transfers.
 */
export function summarizeZakatableCashForZakat(
  accounts: Account[],
  transactions: Transaction[] | undefined,
  sarPerUsd: number,
  asOf: Date = new Date(),
): { totalSar: number; grossTotalSar: number; lines: ZakatCashLine[] } {
  const txs = transactions ?? [];
  const lines: ZakatCashLine[] = [];
  let totalSar = 0;
  let grossTotalSar = 0;

  const cashAccounts = accounts.filter((a) => a.type === 'Checking' || a.type === 'Savings');

  for (const acc of cashAccounts) {
    const currency: 'USD' | 'SAR' = acc.currency === 'USD' ? 'USD' : 'SAR';
    const storedBalance = Math.max(0, Number(acc.balance) || 0);
    grossTotalSar += toSAR(storedBalance, currency, sarPerUsd);

    if (storedBalance <= 0) {
      lines.push({
        accountId: acc.id,
        accountName: acc.name ?? 'Account',
        currency,
        balanceBook: storedBalance,
        grossValueSar: 0,
        zakatableValueSar: 0,
        summaryLabel: 'Zero balance',
        lots: [],
      });
      continue;
    }

    const relevant = txs.filter((t) => t.accountId === acc.id).slice().sort(cmpTx);
    const txNet = transactionNetForAccount(acc.id, txs);
    const openingBalance = storedBalance - txNet;

    const lots: InternalLot[] = [];
    if (openingBalance > 0) {
      lots.push({ ymd: null, amount: openingBalance });
    }

    for (const t of relevant) {
      const amt = Number(t.amount) || 0;
      const ymd = String(t.date ?? '').slice(0, 10);
      if (amt >= 0) {
        if (amt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
          lots.push({ ymd, amount: amt });
        } else if (amt > 0) {
          lots.push({ ymd: null, amount: amt });
        }
      } else {
        consumeFifo(lots, -amt);
      }
    }

    const fifoSum = lots.reduce((s, l) => s + l.amount, 0);
    const tol = Math.max(0.02, 0.005 * storedBalance);
    const mismatch = Math.abs(fifoSum - storedBalance) > tol;

    const lotDetails: ZakatCashLotDetail[] = [];

    if (mismatch) {
      const elig: HawlEligibility = {
        eligible: false,
        label: 'FIFO layers do not reconcile to balance — fix transactions or balance',
      };
      lotDetails.push({
        lotDate: null,
        amountBook: storedBalance,
        grossValueSar: toSAR(storedBalance, currency, sarPerUsd),
        zakatableValueSar: 0,
        hawlEligible: elig.eligible,
        hawlLabel: elig.label,
      });
      lines.push({
        accountId: acc.id,
        accountName: acc.name ?? 'Account',
        currency,
        balanceBook: storedBalance,
        grossValueSar: toSAR(storedBalance, currency, sarPerUsd),
        zakatableValueSar: 0,
        summaryLabel: elig.label,
        lots: lotDetails,
      });
      continue;
    }

    for (const lot of lots) {
      if (lot.amount <= 1e-9) continue;
      const grossSar = toSAR(lot.amount, currency, sarPerUsd);
      let elig: HawlEligibility;
      if (lot.ymd == null) {
        elig = {
          eligible: false,
          label: 'Undated balance layer — add transfers so deposits have dates',
        };
      } else {
        elig = evaluateHawlEligibility(lot.ymd, asOf, false);
      }
      const zSar = elig.eligible ? grossSar : 0;
      lotDetails.push({
        lotDate: lot.ymd,
        amountBook: lot.amount,
        grossValueSar: grossSar,
        zakatableValueSar: zSar,
        hawlEligible: elig.eligible,
        hawlLabel: elig.label,
      });
    }

    const zakatableValueSar = lotDetails.reduce((s, x) => s + x.zakatableValueSar, 0);
    totalSar += zakatableValueSar;

    const pending = lotDetails.filter((x) => !x.hawlEligible).length;
    const summaryLabel =
      zakatableValueSar > 0 && pending === 0
        ? 'Hawl met for all dated cash layers'
        : zakatableValueSar > 0
          ? `${lotDetails.filter((x) => x.hawlEligible).length} layer(s) zakatable; ${pending} pending / undated`
          : lotDetails.some((x) => x.lotDate == null)
            ? 'Undated or pending hawl — cash not counted yet'
            : 'Pending lunar hawl on cash deposits';

    lines.push({
      accountId: acc.id,
      accountName: acc.name ?? 'Account',
      currency,
      balanceBook: storedBalance,
      grossValueSar: toSAR(storedBalance, currency, sarPerUsd),
      zakatableValueSar,
      summaryLabel,
      lots: lotDetails,
    });
  }

  return { totalSar, grossTotalSar, lines };
}
