/**
 * Provisioning logic (logic layer).
 * Provisioning = setting aside money monthly for known future obligations.
 */

export interface ProvisionedCostEvent {
  id?: string;
  /** Known amount due at dueMonth (in base currency for calculations). */
  amount: number;
  /** Month 1-12 when it’s due. */
  dueMonth: number;
  /** Optional: year is ignored by default if you’re modeling "this year". */
  dueYear?: number;
}

export function monthlyProvisionNeeded(args: {
  /**
   * Total known costs due within a horizon.
   * If you already computed totals upstream, you can just pass a single event.
   */
  events: ProvisionedCostEvent[];
  /** How many months remain until the last due event (inclusive). */
  monthsToProvision: number;
}): number {
  const monthsToProvision = Math.max(1, Math.floor(args.monthsToProvision));
  const total = (args.events ?? []).reduce((s, e) => s + Math.max(0, Number(e.amount) || 0), 0);
  return total / monthsToProvision;
}

export function provisionFundingGap(args: {
  /** How much has been provisioned so far (cash reserved). */
  provisionedSoFar: number;
  /** How much should exist given schedule and time. */
  provisionedRequired: number;
}): number {
  const provisionedSoFar = Number.isFinite(args.provisionedSoFar) ? args.provisionedSoFar : 0;
  const required = Number.isFinite(args.provisionedRequired) ? args.provisionedRequired : 0;
  return Math.max(0, required - provisionedSoFar);
}

export function reserveAdequacyCheck(args: {
  reserveBalance: number;
  reserveRequired: number;
  /** Default: 1 means reserve >= required */
  thresholdRatio?: number;
}): { adequate: boolean; ratio: number } {
  const thresholdRatio = args.thresholdRatio ?? 1;
  const reserveBalance = Number.isFinite(args.reserveBalance) ? args.reserveBalance : 0;
  const required = Number.isFinite(args.reserveRequired) ? args.reserveRequired : 0;
  const ratio = required > 0 ? reserveBalance / required : 999;
  return { adequate: ratio >= thresholdRatio, ratio };
}

