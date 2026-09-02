import type { SukukPayoutCadence, SukukPayoutKind } from '../../types';

export type UiLang = 'en' | 'ar';

type Localized = { en: string; ar: string };

function pick(loc: Localized, lang: UiLang = 'en'): string {
  return lang === 'ar' ? loc.ar : loc.en;
}

/** User-facing cadence choices for the Sukuk payout schedule modal. */
export const SUKUK_PAYOUT_CADENCE_OPTIONS: {
  value: Exclude<SukukPayoutCadence, 'custom'>;
  title: Localized;
  description: Localized;
}[] = [
  {
    value: 'maturity_only',
    title: {
      en: 'All at maturity',
      ar: 'كامل المبلغ عند الاستحقاق',
    },
    description: {
      en: 'One payment when the contract ends — profit (optional) plus your capital back.',
      ar: 'دفعة واحدة عند انتهاء العقد — الربح (اختياري) مع استرداد رأس مالك.',
    },
  },
  {
    value: 'monthly',
    title: {
      en: 'Every month',
      ar: 'كل شهر',
    },
    description: {
      en: 'Regular profit each month. You can also return some capital along the way.',
      ar: 'ربح منتظم كل شهر. يمكنك أيضاً استرداد جزء من رأس المال تدريجياً.',
    },
  },
  {
    value: 'quarterly',
    title: {
      en: 'Every 3 months',
      ar: 'كل 3 أشهر',
    },
    description: {
      en: 'Regular profit each quarter. You can also return some capital along the way.',
      ar: 'ربح منتظم كل ربع سنة. يمكنك أيضاً استرداد جزء من رأس المال تدريجياً.',
    },
  },
];

const KIND_LABELS: Record<string, Localized> = {
  coupon: { en: 'profit', ar: 'ربح' },
  principal: { en: 'capital returned', ar: 'رأس مال مُسترد' },
  payout: { en: 'payout', ar: 'دفعة' },
};

const CUSTOM_LABEL: Localized = { en: 'Custom', ar: 'مخصص' };
const SCHEDULE_FALLBACK: Localized = { en: 'Schedule', ar: 'جدول' };

/** Map persisted payout kind → everyday language (never show raw `coupon` / `principal` in UI). */
export function formatSukukPayoutKindLabel(
  kind: SukukPayoutKind | string | null | undefined,
  lang: UiLang = 'en',
): string {
  const key = String(kind ?? 'payout');
  const hit = KIND_LABELS[key];
  if (hit) return pick(hit, lang);
  return key;
}

export function formatSukukPayoutCadenceLabel(
  cadence: SukukPayoutCadence | string | null | undefined,
  lang: UiLang = 'en',
): string {
  const hit = SUKUK_PAYOUT_CADENCE_OPTIONS.find((o) => o.value === cadence);
  if (hit) return pick(hit.title, lang);
  if (cadence === 'custom') return pick(CUSTOM_LABEL, lang);
  return String(cadence ?? pick(SCHEDULE_FALLBACK, lang));
}

export function cadenceOptionTitle(
  option: (typeof SUKUK_PAYOUT_CADENCE_OPTIONS)[number],
  lang: UiLang = 'en',
): string {
  return pick(option.title, lang);
}

export function cadenceOptionDescription(
  option: (typeof SUKUK_PAYOUT_CADENCE_OPTIONS)[number],
  lang: UiLang = 'en',
): string {
  return pick(option.description, lang);
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
