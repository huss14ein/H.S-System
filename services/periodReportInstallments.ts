/**
 * Lightweight installment snapshot for Period Financial Report (optional depth).
 * Plans live in Supabase, not FinancialData — fetch only when the report modal opens.
 */
import { supabase } from './supabaseClient';

export type PeriodReportInstallmentPlan = {
  id: string;
  provider: string;
  currency: string;
  totalAmount: number;
  installmentCount: number;
  status: string;
  description: string;
  budgetCategory: string;
};

export type PeriodReportInstallmentRow = {
  id: string;
  planId: string;
  planName: string;
  sequence: number;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
};

export type PeriodReportInstallmentSnapshot = {
  plans: PeriodReportInstallmentPlan[];
  installments: PeriodReportInstallmentRow[];
  fetchedAtIso: string;
  error?: string;
};

function minorToMajor(minor: string | number | null | undefined): number {
  const n = Number(minor);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

/**
 * Fetch active/pending plans and their installment rows for the signed-in user.
 * Soft-fails to empty snapshot (never throws to callers).
 */
export async function fetchPeriodReportInstallmentSnapshot(
  userId: string | null | undefined,
): Promise<PeriodReportInstallmentSnapshot> {
  const empty: PeriodReportInstallmentSnapshot = {
    plans: [],
    installments: [],
    fetchedAtIso: new Date().toISOString(),
  };
  if (!supabase || !userId) {
    return { ...empty, error: 'Installments unavailable (sign in / Supabase).' };
  }
  try {
    const { data: planRows, error: planErr } = await supabase
      .from('installment_plans')
      .select('id,provider,currency,total_amount_minor,installment_count,status,metadata')
      .order('created_at', { ascending: false })
      .limit(40);
    if (planErr) return { ...empty, error: planErr.message };
    const plans: PeriodReportInstallmentPlan[] = (planRows ?? []).map((r: any) => {
      const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
      return {
        id: String(r.id),
        provider: String(r.provider ?? 'MANUAL'),
        currency: r.currency === 'USD' ? 'USD' : 'SAR',
        totalAmount: minorToMajor(r.total_amount_minor),
        installmentCount: Number(r.installment_count) || 0,
        status: String(r.status ?? ''),
        description: String(meta.description ?? '').trim() || 'Installment plan',
        budgetCategory: String(meta.budgetCategory ?? meta.budget_category ?? '').trim() || 'Installments',
      };
    });
    if (!plans.length) return { ...empty, fetchedAtIso: new Date().toISOString() };

    const planIds = plans.map((p) => p.id);
    const byPlan = new Map(plans.map((p) => [p.id, p]));
    const { data: instRows, error: instErr } = await supabase
      .from('installments')
      .select('id,plan_id,sequence,due_date,amount_minor,status,paid_at')
      .in('plan_id', planIds)
      .order('due_date', { ascending: true })
      .limit(400);
    if (instErr) {
      return { plans, installments: [], fetchedAtIso: new Date().toISOString(), error: instErr.message };
    }
    const installments: PeriodReportInstallmentRow[] = (instRows ?? []).map((r: any) => {
      const plan = byPlan.get(String(r.plan_id));
      return {
        id: String(r.id),
        planId: String(r.plan_id),
        planName: plan?.description ?? 'Plan',
        sequence: Number(r.sequence) || 0,
        dueDate: String(r.due_date ?? '').slice(0, 10),
        amount: minorToMajor(r.amount_minor),
        currency: plan?.currency ?? 'SAR',
        status: String(r.status ?? ''),
        paidAt: r.paid_at ? String(r.paid_at) : null,
      };
    });
    return { plans, installments, fetchedAtIso: new Date().toISOString() };
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : 'Failed to load installments',
    };
  }
}

/** Filter installment rows whose due date falls in [startIso, endIso] inclusive. */
export function filterInstallmentsInWindow(
  rows: PeriodReportInstallmentRow[],
  startIso: string,
  endIso: string,
): PeriodReportInstallmentRow[] {
  const a = String(startIso).slice(0, 10);
  const b = String(endIso).slice(0, 10);
  return rows.filter((r) => {
    const d = String(r.dueDate).slice(0, 10);
    return d >= a && d <= b;
  });
}
