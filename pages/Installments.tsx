import React, { useContext, useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { buildInstallmentSchedule } from '../services/installments/installmentMath';
import { encodeInstallmentPaymentNote } from '../services/installments/installmentLinkNote';

type InstallmentPlanRow = {
  id: string;
  provider: string;
  currency: string;
  total_amount_minor: string;
  installment_count: number;
  merchant_order_id: string | null;
  status: string;
  created_at: string;
  metadata?: any;
};

type InstallmentRow = {
  id: string;
  plan_id: string;
  sequence: number;
  due_date: string;
  amount_minor: string;
  status: string;
  provider_payment_id: string | null;
  paid_at: string | null;
  failure_code: string | null;
};

const InstallmentsPage: React.FC<{ setActivePage?: (p: any) => void }> = () => {
  const { data, addTransaction } = useContext(DataContext)!;
  const auth = useContext(AuthContext);
  const { formatCurrencyString } = useFormatCurrency();
  const [plans, setPlans] = useState<InstallmentPlanRow[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    description: '',
    budgetCategory: '',
    currency: 'SAR' as 'SAR' | 'USD',
    totalAmount: '',
    installmentCount: 4,
    firstInstallmentAmount: '',
    firstDueDate: new Date().toISOString().slice(0, 10),
  });
  const [creating, setCreating] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState<{ installmentId: string; accountId: string; date: string; description: string }>({
    installmentId: '',
    accountId: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
  });

  const userId = auth?.user?.id ?? null;
  const isReady = Boolean(supabase && userId);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!supabase || !userId) return;
      setLoading(true);
      setErr(null);
      const { data: rows, error } = await supabase
        .from('installment_plans')
        .select('id,provider,currency,total_amount_minor,installment_count,merchant_order_id,status,created_at,metadata')
        .order('created_at', { ascending: false });
      if (!alive) return;
      if (error) setErr(error.message);
      setPlans((rows ?? []) as any);
      setLoading(false);
    };
    run();
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!supabase || !selectedPlanId) return;
      const { data: rows, error } = await supabase
        .from('installments')
        .select('id,plan_id,sequence,due_date,amount_minor,status,provider_payment_id,paid_at,failure_code')
        .eq('plan_id', selectedPlanId)
        .order('sequence', { ascending: true });
      if (!alive) return;
      if (error) setErr(error.message);
      setInstallments((rows ?? []) as any);
    };
    run();
    return () => {
      alive = false;
    };
  }, [selectedPlanId]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === selectedPlanId) ?? null, [plans, selectedPlanId]);
  const selectedPlanBudgetCategory = useMemo(() => {
    const meta = (selectedPlan as any)?.metadata;
    const bc = meta && typeof meta === 'object' ? String(meta.budgetCategory ?? meta.budget_category ?? '').trim() : '';
    return bc || 'Installments';
  }, [selectedPlan]);
  const selectedPlanDescription = useMemo(() => {
    const meta = (selectedPlan as any)?.metadata;
    const d = meta && typeof meta === 'object' ? String(meta.description ?? '').trim() : '';
    return d || 'Installment purchase';
  }, [selectedPlan]);

  const eligibleAccounts = useMemo(() => {
    const cur = selectedPlan?.currency === 'USD' ? 'USD' : 'SAR';
    return (data?.accounts ?? []).filter((a) => a.type !== 'Investment' && (a.currency === 'USD' ? 'USD' : 'SAR') === cur);
  }, [data?.accounts, selectedPlan?.currency]);

  const openPay = (inst: InstallmentRow) => {
    if (!selectedPlan) return;
    setPayingId(inst.id);
    setPayForm({
      installmentId: inst.id,
      accountId: eligibleAccounts[0]?.id ?? '',
      date: inst.due_date || new Date().toISOString().slice(0, 10),
      description: `${selectedPlanDescription} · installment ${inst.sequence}/${selectedPlan.installment_count}`,
    });
  };

  const submitPay = async () => {
    if (!selectedPlan) return;
    const inst = installments.find((x) => x.id === payForm.installmentId);
    if (!inst) return;
    if (!payForm.accountId) return;
    const amount = (Number(inst.amount_minor) || 0) / 100;
    const note = encodeInstallmentPaymentNote(undefined, inst.id);
    await addTransaction({
      date: payForm.date,
      description: payForm.description.trim() || `${selectedPlanDescription} installment`,
      amount: -Math.abs(amount),
      type: 'expense',
      accountId: payForm.accountId,
      category: selectedPlanBudgetCategory,
      budgetCategory: selectedPlanBudgetCategory,
      note,
      transactionNature: 'Fixed',
      expenseType: 'Core',
    } as any);
    setPayingId(null);
    // Reload installment rows so UI reflects PAID status (Budgets updates automatically via status filter).
    if (supabase && selectedPlanId) {
      const { data: rows } = await supabase
        .from('installments')
        .select('id,plan_id,sequence,due_date,amount_minor,status,provider_payment_id,paid_at,failure_code')
        .eq('plan_id', selectedPlanId)
        .order('sequence', { ascending: true });
      setInstallments((rows ?? []) as any);
    }
  };

  const toMoney = (minor: string, currency: string) => {
    const asNumber = Number(minor) / 100;
    return formatCurrencyString(asNumber, { inCurrency: currency === 'USD' ? 'USD' : 'SAR', digits: 2 });
  };

  const reloadPlans = async () => {
    if (!supabase || !userId) return;
    const { data: rows, error } = await supabase
      .from('installment_plans')
      .select('id,provider,currency,total_amount_minor,installment_count,merchant_order_id,status,created_at,metadata')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setPlans((rows ?? []) as any);
  };

  const createBudgetOnlyInstallmentPlan = async () => {
    if (!supabase || !userId) return;
    setErr(null);
    setCreating(true);
    try {
      const total = Number(createForm.totalAmount);
      if (!Number.isFinite(total) || total <= 0) throw new Error('Total amount must be a positive number.');
      const count = Math.trunc(Number(createForm.installmentCount));
      if (!Number.isFinite(count) || count < 1 || count > 48) throw new Error('Installment count must be between 1 and 48.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(createForm.firstDueDate)) throw new Error('First due date must be YYYY-MM-DD.');

      const totalMinor = BigInt(Math.round(total * 100));
      const first = createForm.firstInstallmentAmount.trim()
        ? BigInt(Math.round(Number(createForm.firstInstallmentAmount) * 100))
        : null;
      if (createForm.firstInstallmentAmount.trim() && (!Number.isFinite(Number(createForm.firstInstallmentAmount)) || Number(createForm.firstInstallmentAmount) <= 0)) {
        throw new Error('First installment amount must be a positive number.');
      }

      const sched = buildInstallmentSchedule({
        totalAmountMinor: totalMinor,
        installmentCount: count,
        firstInstallmentAmountMinor: first,
      });

      const merchantOrderId = `manual-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 8)}`;
      const metadata = {
        mode: 'budget_projection_only',
        description: createForm.description.trim() || 'Installment purchase',
        budgetCategory: (createForm.budgetCategory.trim() || 'Installments'),
      };

      const { data: plan, error: planErr } = await supabase
        .from('installment_plans')
        .insert({
          user_id: userId,
          provider: 'OTHER',
          currency: createForm.currency,
          total_amount_minor: totalMinor.toString(),
          installment_count: count,
          first_installment_amount_minor: first ? first.toString() : null,
          merchant_order_id: merchantOrderId,
          status: 'ACTIVE',
          metadata,
          activated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (planErr) throw new Error(planErr.message);

      const start = new Date(`${createForm.firstDueDate}T00:00:00Z`);
      const dueDates = Array.from({ length: count }).map((_, i) => {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, start.getUTCDate()));
        return d.toISOString().slice(0, 10);
      });

      const instRows = sched.amountsMinor.map((amt, idx) => ({
        plan_id: plan.id,
        sequence: idx + 1,
        due_date: dueDates[idx],
        amount_minor: amt.toString(),
        status: 'SCHEDULED',
        metadata: {},
      }));
      const { error: instErr } = await supabase.from('installments').insert(instRows);
      if (instErr) throw new Error(instErr.message);

      await reloadPlans();
      setCreateForm((p) => ({ ...p, totalAmount: '', firstInstallmentAmount: '', description: '' }));
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageLayout
      title="Installments"
      description="Record installment purchases so each month’s budget reflects only that month’s due payment — without consuming today’s budget."
    >
      <div className="space-y-6">
        {!isReady && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Installments require Supabase login and database setup. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then run the new SQL migration in Supabase.
          </div>
        )}

        {err && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{err}</div>}

        <SectionCard
          title="Record an installment purchase (budget-safe)"
          infoHint="This records an installment schedule so each month’s budget is consumed only by that month’s installment, not the full amount today. It does not change your account balance today."
          collapsible
          collapsibleSummary="Create a new plan (no provider integration needed)"
          defaultExpanded={false}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                value={createForm.description}
                onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="e.g., Phone purchase, Sofa, Laptop"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Budget category (must match Budgets)</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                value={createForm.budgetCategory}
                onChange={(e) => setCreateForm((p) => ({ ...p, budgetCategory: e.target.value }))}
                placeholder="e.g., Shopping, Electronics, Home"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Currency</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                value={createForm.currency}
                onChange={(e) => setCreateForm((p) => ({ ...p, currency: e.target.value as 'SAR' | 'USD' }))}
              >
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total amount</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                value={createForm.totalAmount}
                onChange={(e) => setCreateForm((p) => ({ ...p, totalAmount: e.target.value }))}
                placeholder="e.g., 2500"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Installments</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                type="number"
                min={1}
                max={48}
                value={createForm.installmentCount}
                onChange={(e) => setCreateForm((p) => ({ ...p, installmentCount: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">First installment (optional higher)</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                value={createForm.firstInstallmentAmount}
                onChange={(e) => setCreateForm((p) => ({ ...p, firstInstallmentAmount: e.target.value }))}
                placeholder="leave empty for equal split"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">First due date</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                type="date"
                value={createForm.firstDueDate}
                onChange={(e) => setCreateForm((p) => ({ ...p, firstDueDate: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={createBudgetOnlyInstallmentPlan}
              disabled={!isReady || creating}
            >
              {creating ? 'Creating…' : 'Create installment schedule'}
            </button>
            <span className="text-xs text-slate-500">This immediately affects Budgets (by due month).</span>
          </div>
        </SectionCard>

        <SectionCard
          title="Plans"
          infoHint="Each plan is a manual installment schedule. Amounts are stored in minor units so sums are exact."
          collapsible
          collapsibleSummary="Your installment plans"
          defaultExpanded
        >
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-slate-600">No installment plans yet.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b">
                    <th className="py-2 pr-3 text-left">Created</th>
                    <th className="py-2 pr-3 text-left">Status</th>
                    <th className="py-2 pr-3 text-left">Total</th>
                    <th className="py-2 pr-3 text-left">#</th>
                    <th className="py-2 pr-3 text-left">Budget category</th>
                    <th className="py-2 pr-3 text-left">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-b hover:bg-slate-50/70 cursor-pointer ${selectedPlanId === p.id ? 'bg-indigo-50/40' : ''}`}
                      onClick={() => setSelectedPlanId(p.id)}
                    >
                      <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            p.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-900'
                              : p.status === 'ACTIVE'
                                ? 'bg-sky-100 text-sky-900'
                                : p.status === 'CANCELLED'
                                  ? 'bg-slate-200 text-slate-700'
                                  : 'bg-amber-100 text-amber-950'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{toMoney(p.total_amount_minor, p.currency)}</td>
                      <td className="py-2 pr-3 tabular-nums">{p.installment_count}</td>
                      <td className="py-2 pr-3 text-slate-600">{String((p as any)?.metadata?.budgetCategory ?? '').trim() || 'Installments'}</td>
                      <td className="py-2 pr-3 text-slate-600">{String((p as any)?.metadata?.description ?? '').trim() || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Schedule"
          infoHint="Each installment has its own due date and status. Totals must always add up exactly to the plan."
          collapsible
          collapsibleSummary="Installments for selected plan"
          defaultExpanded
        >
          {!selectedPlan ? (
            <p className="text-sm text-slate-600">Select a plan above to see its installments.</p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                <div className="rounded-lg border bg-slate-50 p-2">
                  <span className="text-slate-500">Plan</span>
                  <div className="font-semibold text-slate-900 truncate">{selectedPlan.id}</div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2">
                  <span className="text-slate-500">Budget category</span>
                  <div className="font-semibold text-slate-900 truncate">
                    {String((selectedPlan as any)?.metadata?.budgetCategory ?? '').trim() || 'Installments'}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2">
                  <span className="text-slate-500">Description</span>
                  <div className="font-semibold text-slate-900 truncate">
                    {String((selectedPlan as any)?.metadata?.description ?? '').trim() || '—'}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-2">
                  <span className="text-slate-500">Total</span>
                  <div className="font-semibold text-slate-900 tabular-nums">{toMoney(selectedPlan.total_amount_minor, selectedPlan.currency)}</div>
                </div>
              </div>

              {installments.length === 0 ? (
                <p className="text-sm text-slate-600">No installments found for this plan.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr className="border-b">
                        <th className="py-2 pr-3 text-left">#</th>
                        <th className="py-2 pr-3 text-left">Due</th>
                        <th className="py-2 pr-3 text-left">Amount</th>
                        <th className="py-2 pr-3 text-left">Status</th>
                        <th className="py-2 pr-3 text-left">Paid</th>
                        <th className="py-2 pr-3 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {installments.map((i) => (
                        <tr key={i.id} className="border-b hover:bg-slate-50/70">
                          <td className="py-2 pr-3 tabular-nums font-medium">{i.sequence}</td>
                          <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{i.due_date}</td>
                          <td className="py-2 pr-3 tabular-nums">{toMoney(i.amount_minor, selectedPlan.currency)}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                                i.status === 'PAID'
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : i.status === 'FAILED'
                                    ? 'bg-rose-100 text-rose-900'
                                    : i.status === 'DUE'
                                      ? 'bg-amber-100 text-amber-950'
                                      : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {i.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{i.paid_at ? new Date(i.paid_at).toLocaleString() : '—'}</td>
                          <td className="py-2 pr-3">
                            {payingId === i.id ? (
                              <div className="flex flex-wrap items-end gap-2">
                                <div>
                                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Account</label>
                                  <select
                                    className="mt-1 rounded-md border border-slate-300 bg-white p-2 text-xs"
                                    value={payForm.accountId}
                                    onChange={(e) => setPayForm((p) => ({ ...p, accountId: e.target.value }))}
                                  >
                                    <option value="">Select…</option>
                                    {eligibleAccounts.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date</label>
                                  <input
                                    type="date"
                                    className="mt-1 rounded-md border border-slate-300 bg-white p-2 text-xs"
                                    value={payForm.date}
                                    onChange={(e) => setPayForm((p) => ({ ...p, date: e.target.value }))}
                                  />
                                </div>
                                <div className="min-w-[220px] flex-1">
                                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Description</label>
                                  <input
                                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-xs"
                                    value={payForm.description}
                                    onChange={(e) => setPayForm((p) => ({ ...p, description: e.target.value }))}
                                  />
                                </div>
                                <button
                                  type="button"
                                  className="btn-primary !px-3 !py-2 !text-xs"
                                  onClick={submitPay}
                                  disabled={!payForm.accountId}
                                >
                                  Save payment
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary !px-3 !py-2 !text-xs"
                                  onClick={() => setPayingId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="text-xs font-semibold text-primary-600 hover:text-primary-700 underline disabled:opacity-50"
                                disabled={['PAID', 'REFUNDED', 'CANCELLED', 'WAIVED'].includes(String(i.status ?? '').toUpperCase())}
                                onClick={() => openPay(i)}
                              >
                                Record payment
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </SectionCard>
      </div>
    </PageLayout>
  );
};

export default InstallmentsPage;

