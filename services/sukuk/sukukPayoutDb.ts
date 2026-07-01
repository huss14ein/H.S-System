import type { SukukPayoutEvent, SukukPayoutSchedule, TradeCurrency } from '../../types';
import { roundMoney } from '../../utils/money';

export function normalizeSukukPayoutScheduleRow(r: any): SukukPayoutSchedule {
  return {
    id: r.id,
    user_id: r.user_id ?? r.userId,
    sukukPositionId: r.sukuk_position_id ?? r.sukukPositionId ?? r.asset_id ?? r.assetId,
    investmentAccountId: r.investment_account_id ?? r.investmentAccountId,
    currency: (r.currency ?? 'SAR') as TradeCurrency,
    cadence: r.cadence,
    dayOfMonth: r.day_of_month ?? r.dayOfMonth ?? null,
    couponAmount: r.coupon_amount ?? r.couponAmount ?? null,
    principalAmount: r.principal_amount ?? r.principalAmount ?? null,
    principalInstallmentAmount: r.principal_installment_amount ?? r.principalInstallmentAmount ?? null,
    startDate: r.start_date ?? r.startDate ?? null,
    endDate: r.end_date ?? r.endDate ?? null,
    enabled: r.enabled ?? true,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
  };
}

export function normalizeSukukPayoutEventRow(r: any): SukukPayoutEvent {
  return {
    id: r.id,
    user_id: r.user_id ?? r.userId,
    scheduleId: r.schedule_id ?? r.scheduleId,
    sukukPositionId: r.sukuk_position_id ?? r.sukukPositionId ?? r.asset_id ?? r.assetId,
    investmentAccountId: r.investment_account_id ?? r.investmentAccountId,
    kind: r.kind,
    payoutDate: r.payout_date ?? r.payoutDate,
    amount: roundMoney(Number(r.amount ?? 0)),
    currency: (r.currency ?? 'SAR') as TradeCurrency,
    posted: Boolean(r.posted),
    postedAt: r.posted_at ?? r.postedAt ?? null,
    postedInvestmentTransactionId: r.posted_investment_transaction_id ?? r.postedInvestmentTransactionId ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at ?? r.createdAt,
  };
}

export function sukukPayoutScheduleToRow(s: SukukPayoutSchedule): Record<string, unknown> {
  return {
    sukuk_position_id: s.sukukPositionId,
    investment_account_id: s.investmentAccountId,
    currency: s.currency === 'USD' ? 'USD' : 'SAR',
    cadence: s.cadence,
    day_of_month: s.dayOfMonth ?? null,
    coupon_amount: s.couponAmount ?? null,
    principal_amount: s.principalAmount ?? null,
    principal_installment_amount: s.principalInstallmentAmount ?? null,
    start_date: s.startDate ?? null,
    end_date: s.endDate ?? null,
    enabled: s.enabled ?? true,
    metadata: s.metadata ?? {},
  };
}

export function sukukPayoutEventToRow(e: SukukPayoutEvent): Record<string, unknown> {
  return {
    schedule_id: e.scheduleId,
    sukuk_position_id: e.sukukPositionId,
    investment_account_id: e.investmentAccountId,
    kind: e.kind,
    payout_date: e.payoutDate,
    amount: roundMoney(e.amount),
    currency: e.currency === 'USD' ? 'USD' : 'SAR',
    posted: e.posted,
    posted_at: e.postedAt ?? null,
    posted_investment_transaction_id: e.postedInvestmentTransactionId ?? null,
    metadata: e.metadata ?? {},
  };
}
