export type InstallmentSchedule = {
  totalAmountMinor: bigint;
  installmentCount: number;
  firstInstallmentAmountMinor?: bigint | null;
  amountsMinor: bigint[];
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/**
 * Split a total amount (minor units) into N installments.
 *
 * Guarantees:
 * - All amounts are integers (bigint)
 * - Sum(amounts) == total
 * - Deterministic remainder distribution (earlier installments get +1)
 *
 * If `firstInstallmentAmountMinor` is provided, it will be used as installment #1
 * and the remainder is split across N-1 installments with the same guarantees.
 */
export function buildInstallmentSchedule(args: {
  totalAmountMinor: bigint | number;
  installmentCount: number;
  firstInstallmentAmountMinor?: bigint | number | null;
}): InstallmentSchedule {
  const total = typeof args.totalAmountMinor === 'bigint' ? args.totalAmountMinor : BigInt(Math.trunc(args.totalAmountMinor));
  const n = Math.trunc(args.installmentCount);
  assert(n >= 1, 'installmentCount must be >= 1');
  assert(total > 0n, 'totalAmountMinor must be > 0');

  const firstRaw = args.firstInstallmentAmountMinor;
  const first =
    firstRaw == null ? null : typeof firstRaw === 'bigint' ? firstRaw : BigInt(Math.trunc(firstRaw));

  if (n === 1) {
    assert(first == null || first === total, 'For a single installment, firstInstallmentAmountMinor must equal total');
    return { totalAmountMinor: total, installmentCount: n, firstInstallmentAmountMinor: total, amountsMinor: [total] };
  }

  if (first != null) {
    assert(first > 0n, 'firstInstallmentAmountMinor must be > 0');
    assert(first < total, 'firstInstallmentAmountMinor must be < total when installmentCount > 1');
  }

  const amounts: bigint[] = [];
  const remainingCount = first != null ? n - 1 : n;
  const remainingTotal = first != null ? total - first : total;

  const base = remainingTotal / BigInt(remainingCount);
  const rem = remainingTotal % BigInt(remainingCount);

  if (first != null) amounts.push(first);
  for (let i = 0; i < remainingCount; i++) {
    const extra = BigInt(i) < rem ? 1n : 0n;
    amounts.push(base + extra);
  }

  const sum = amounts.reduce((s, x) => s + x, 0n);
  assert(sum === total, 'installment schedule does not sum to total');
  assert(amounts.length === n, 'installment schedule length mismatch');
  assert(amounts.every((x) => x > 0n), 'installment schedule contains non-positive amount');

  return {
    totalAmountMinor: total,
    installmentCount: n,
    firstInstallmentAmountMinor: first,
    amountsMinor: amounts,
  };
}

