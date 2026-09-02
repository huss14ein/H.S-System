import type { SukukPayoutCadence, SukukPayoutKind } from '../../types';

/** User-facing cadence choices for the Sukuk payout schedule modal. */
export const SUKUK_PAYOUT_CADENCE_OPTIONS: {
  value: Exclude<SukukPayoutCadence, 'custom'>;
  title: string;
  description: string;
}[] = [
  {
    value: 'maturity_only',
    title: 'All at maturity',
    description: 'One payment when the contract ends — profit (optional) plus your capital back.',
  },
  {
    value: 'monthly',
    title: 'Every month',
    description: 'Regular profit each month. You can also return some capital along the way.',
  },
  {
    value: 'quarterly',
    title: 'Every 3 months',
    description: 'Regular profit each quarter. You can also return some capital along the way.',
  },
];

/** Map persisted payout kind → everyday language (never show raw `coupon` / `principal` in UI). */
export function formatSukukPayoutKindLabel(kind: SukukPayoutKind | string | null | undefined): string {
  if (kind === 'coupon') return 'profit';
  if (kind === 'principal') return 'capital returned';
  return String(kind ?? 'payout');
}

export function formatSukukPayoutCadenceLabel(cadence: SukukPayoutCadence | string | null | undefined): string {
  const hit = SUKUK_PAYOUT_CADENCE_OPTIONS.find((o) => o.value === cadence);
  if (hit) return hit.title;
  if (cadence === 'custom') return 'Custom';
  return String(cadence ?? 'Schedule');
}

/** Banned user-facing jargon — keep out of pages/components (domain code may still use coupon/principal). */
export const SUKUK_PAYOUT_UX_BANNED_STRINGS = [
  'Bullet — pay at maturity',
  'Monthly coupons (+ optional principal installments)',
  'Quarterly coupons (+ optional principal installments)',
  'Coupon per period',
  'Principal installment (optional)',
  'Final principal at maturity (blank = remaining outstanding)',
  'Set payouts',
  'Edit payouts',
] as const;
