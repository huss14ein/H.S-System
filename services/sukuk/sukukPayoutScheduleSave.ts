import type { SukukPayoutCadence, SukukPayoutEvent, SukukPayoutSchedule, SukukPosition } from '../../types';
import { materializeSukukPayoutEvents } from './sukukPayoutEngine';
import { normalizeSukukPayoutScheduleRow, normalizeSukukPayoutEventRow } from './sukukPayoutDb';

export type SaveSukukPayoutScheduleInput = {
  userId: string;
  position: SukukPosition;
  existingSchedule: SukukPayoutSchedule | null;
  investmentAccountId: string;
  currency: 'SAR' | 'USD';
  cadence: SukukPayoutCadence;
  dayOfMonth?: number | null;
  couponAmount?: number | null;
  principalAmount?: number | null;
  principalInstallmentAmount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  enabled?: boolean;
  scheduleId?: string;
};

function newScheduleId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sukuk_${Date.now()}`;
  }
}

/** Persist schedule + materialized unposted events; returns normalized rows for local state. */
export async function saveSukukPayoutScheduleToDb(
  db: { from: (table: string) => any },
  input: SaveSukukPayoutScheduleInput,
): Promise<{ schedule: SukukPayoutSchedule; events: SukukPayoutEvent[] }> {
  const scheduleId = input.scheduleId ?? input.existingSchedule?.id ?? newScheduleId();
  const dom =
    input.cadence === 'monthly' || input.cadence === 'quarterly'
      ? Math.max(1, Math.min(28, Math.trunc(Number(input.dayOfMonth ?? 1))))
      : null;
  const scheduleRow = {
    id: scheduleId,
    user_id: input.userId,
    sukuk_position_id: input.position.id,
    investment_account_id: input.investmentAccountId,
    currency: input.currency,
    cadence: input.cadence,
    day_of_month: dom,
    coupon_amount: input.couponAmount ?? null,
    principal_amount: input.principalAmount ?? null,
    principal_installment_amount: input.principalInstallmentAmount ?? null,
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    enabled: input.enabled ?? true,
    metadata: {},
  };

  const upsertRes = await db.from('sukuk_payout_schedules').upsert(scheduleRow, { onConflict: 'id' }).select('*').maybeSingle();
  if (upsertRes.error) throw new Error(upsertRes.error.message);

  await db.from('sukuk_payout_events').delete().eq('schedule_id', scheduleId).eq('posted', false);

  const drafts = materializeSukukPayoutEvents({
    schedule: {
      id: scheduleId,
      sukukPositionId: input.position.id,
      investmentAccountId: input.investmentAccountId,
      currency: input.currency,
      cadence: input.cadence,
      dayOfMonth: dom,
      couponAmount: input.couponAmount,
      principalAmount: input.principalAmount,
      principalInstallmentAmount: input.principalInstallmentAmount,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      enabled: input.enabled ?? true,
    },
    positionDates: { issueDate: input.position.issueDate, maturityDate: input.position.maturityDate },
    outstandingPrincipal: input.position.outstandingPrincipal,
  });

  let insertedEvents: SukukPayoutEvent[] = [];
  if (drafts.length) {
    const eventRows = drafts.map((d) => ({
      user_id: input.userId,
      schedule_id: d.scheduleId,
      sukuk_position_id: d.sukukPositionId,
      investment_account_id: d.investmentAccountId,
      kind: d.kind,
      payout_date: d.payoutDate,
      amount: d.amount,
      currency: d.currency,
      metadata: d.metadata ?? {},
    }));
    const ins = await db
      .from('sukuk_payout_events')
      .upsert(eventRows, { onConflict: 'schedule_id,kind,payout_date' })
      .select('*');
    if (ins.error) throw new Error(ins.error.message);
    insertedEvents = ((ins.data as unknown[]) ?? []).map(normalizeSukukPayoutEventRow);
  }

  const schedule = normalizeSukukPayoutScheduleRow(upsertRes.data ?? scheduleRow);
  return { schedule, events: insertedEvents };
}
