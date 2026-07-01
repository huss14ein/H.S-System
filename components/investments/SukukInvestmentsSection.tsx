import React, { useContext, useEffect, useMemo, useState } from 'react';
import { BanknotesIcon } from '../icons/BanknotesIcon';
import { PencilIcon } from '../icons/PencilIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { DataContext } from '../../context/DataContext';
import type { Account, Goal, SukukPayoutCadence, SukukPayoutEvent, SukukPayoutSchedule, SukukPosition } from '../../types';
import Modal from '../Modal';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { parseMoneyInput, roundMoney } from '../../utils/money';
import { getPersonalSukukPositions } from '../../utils/wealthScope';

const SukukPositionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  positionToEdit: SukukPosition | null;
  accounts: Account[];
  goals: Goal[];
  onSave: (position: Omit<SukukPosition, 'id' | 'user_id'> | SukukPosition) => Promise<void>;
}> = ({ isOpen, onClose, positionToEdit, accounts, goals, onSave }) => {
  const [name, setName] = useState('');
  const [investmentAccountId, setInvestmentAccountId] = useState('');
  const [currency, setCurrency] = useState<'SAR' | 'USD'>('SAR');
  const [faceValue, setFaceValue] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');
  const [goalId, setGoalId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(positionToEdit?.name ?? '');
    setInvestmentAccountId(positionToEdit?.investmentAccountId ?? '');
    setCurrency(positionToEdit?.currency === 'USD' ? 'USD' : 'SAR');
    setFaceValue(positionToEdit ? String(positionToEdit.faceValue) : '');
    setPurchasePrice(positionToEdit?.purchasePrice != null ? String(positionToEdit.purchasePrice) : '');
    setIssueDate(positionToEdit?.issueDate ?? '');
    setMaturityDate(positionToEdit?.maturityDate ?? '');
    setGoalId(positionToEdit?.goalId ?? '');
    setNotes(positionToEdit?.notes ?? '');
    setError(null);
  }, [isOpen, positionToEdit]);

  const investmentAccounts = accounts.filter(
    (a) => (a.type ?? '').toLowerCase().includes('investment') || (a.name ?? '').toLowerCase().includes('platform'),
  );

  const handleSave = async () => {
    setError(null);
    const fv = parseMoneyInput(faceValue);
    const pp = purchasePrice.trim() === '' ? null : parseMoneyInput(purchasePrice);
    if (fv == null || !Number.isFinite(fv) || fv < 0) {
      setError('Face value must be a non-negative number.');
      return;
    }
    if (!investmentAccountId) {
      setError('Choose the mapped investment platform account.');
      return;
    }
    if (!issueDate || !maturityDate) {
      setError('Issue and maturity dates are required.');
      return;
    }
    setIsSaving(true);
    try {
      const base = {
        name: name.trim(),
        investmentAccountId,
        currency,
        faceValue: fv,
        outstandingPrincipal: positionToEdit?.outstandingPrincipal ?? fv,
        purchasePrice: pp,
        issueDate: issueDate.slice(0, 10),
        maturityDate: maturityDate.slice(0, 10),
        status: (positionToEdit?.status ?? 'active') as SukukPosition['status'],
        goalId: goalId || null,
        notes: notes.trim() || null,
      };
      if (positionToEdit?.id) await onSave({ ...base, id: positionToEdit.id });
      else await onSave(base);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save Sukuk.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={positionToEdit ? 'Edit Sukuk contract' : 'Add Sukuk contract'}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 bg-sky-50 border border-sky-100 rounded-lg p-3">
          Direct Sukuk contracts live under Investments (not Assets). For broker-held Sukuk funds, use <strong>Record Trade</strong> with asset class Sukuk.
        </p>
        <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name" />
        <select className="select-base" value={investmentAccountId} onChange={(e) => setInvestmentAccountId(e.target.value)}>
          <option value="">Mapped platform account…</option>
          {investmentAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className="select-base" value={currency} onChange={(e) => setCurrency(e.target.value as 'SAR' | 'USD')}>
          <option value="SAR">SAR</option>
          <option value="USD">USD</option>
        </select>
        <input className="input-base" type="number" min={0} step="any" value={faceValue} onChange={(e) => setFaceValue(e.target.value)} placeholder="Face value" />
        <input className="input-base" type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="Purchase price (optional)" />
        <div className="grid grid-cols-2 gap-3">
          <input className="input-base" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          <input className="input-base" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
        </div>
        <select className="select-base" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          <option value="">No goal link</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <textarea className="input-base min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
        {error && <div className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        <button disabled={isSaving} onClick={handleSave} className="w-full btn-primary">{isSaving ? 'Saving…' : 'Save Sukuk'}</button>
      </div>
    </Modal>
  );
};

const SukukPayoutScheduleModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  position: SukukPosition;
  accounts: Account[];
  existingSchedule: SukukPayoutSchedule | null;
  existingEvents: SukukPayoutEvent[];
  onSave: (input: {
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
  }) => Promise<void>;
}> = ({ isOpen, onClose, position, accounts, existingSchedule, existingEvents, onSave }) => {
  const [investmentAccountId, setInvestmentAccountId] = useState(existingSchedule?.investmentAccountId ?? position.investmentAccountId);
  const [cadence, setCadence] = useState<SukukPayoutCadence>(existingSchedule?.cadence ?? 'maturity_only');
  const [dayOfMonth, setDayOfMonth] = useState(String(existingSchedule?.dayOfMonth ?? 25));
  const [couponAmount, setCouponAmount] = useState(existingSchedule?.couponAmount != null ? String(existingSchedule.couponAmount) : '');
  const [principalAmount, setPrincipalAmount] = useState(existingSchedule?.principalAmount != null ? String(existingSchedule.principalAmount) : '');
  const [principalInstallment, setPrincipalInstallment] = useState(
    existingSchedule?.principalInstallmentAmount != null ? String(existingSchedule.principalInstallmentAmount) : '',
  );
  const [startDate, setStartDate] = useState(existingSchedule?.startDate ?? position.issueDate ?? '');
  const [endDate, setEndDate] = useState(existingSchedule?.endDate ?? position.maturityDate ?? '');
  const [currency, setCurrency] = useState<'SAR' | 'USD'>((existingSchedule?.currency as 'SAR' | 'USD') ?? position.currency ?? 'SAR');
  const [enabled, setEnabled] = useState(existingSchedule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setInvestmentAccountId(existingSchedule?.investmentAccountId ?? position.investmentAccountId);
    setCadence(existingSchedule?.cadence ?? 'maturity_only');
    setDayOfMonth(String(existingSchedule?.dayOfMonth ?? 25));
    setCouponAmount(existingSchedule?.couponAmount != null ? String(existingSchedule.couponAmount) : '');
    setPrincipalAmount(existingSchedule?.principalAmount != null ? String(existingSchedule.principalAmount) : '');
    setPrincipalInstallment(existingSchedule?.principalInstallmentAmount != null ? String(existingSchedule.principalInstallmentAmount) : '');
    setStartDate(existingSchedule?.startDate ?? position.issueDate ?? '');
    setEndDate(existingSchedule?.endDate ?? position.maturityDate ?? '');
    setCurrency((existingSchedule?.currency as 'SAR' | 'USD') ?? position.currency ?? 'SAR');
    setEnabled(existingSchedule?.enabled ?? true);
    setError(null);
  }, [isOpen, existingSchedule, position]);

  const investmentAccounts = accounts.filter(
    (a) => (a.type ?? '').toLowerCase().includes('investment') || (a.name ?? '').toLowerCase().includes('platform'),
  );

  const nextEvent = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (existingEvents || [])
      .filter((e) => !e.posted && e.payoutDate >= today)
      .sort((a, b) => a.payoutDate.localeCompare(b.payoutDate))[0] ?? null;
  }, [existingEvents]);

  const handleSave = async () => {
    setError(null);
    if (!investmentAccountId) {
      setError('Choose the Sukuk platform account.');
      return;
    }
    const dom = Math.max(1, Math.min(28, Math.trunc(Number(dayOfMonth || '1'))));
    const coupon = couponAmount.trim() === '' ? null : parseMoneyInput(couponAmount);
    const principal = principalAmount.trim() === '' ? null : parseMoneyInput(principalAmount);
    const principalInst = principalInstallment.trim() === '' ? null : parseMoneyInput(principalInstallment);

    setIsSaving(true);
    try {
      await onSave({
        investmentAccountId,
        currency,
        cadence,
        dayOfMonth: cadence === 'monthly' || cadence === 'quarterly' ? dom : null,
        couponAmount: coupon,
        principalAmount: principal,
        principalInstallmentAmount: principalInst,
        startDate: startDate || null,
        endDate: endDate || null,
        enabled,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save schedule.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sukuk payout schedule">
      <div className="space-y-4">
        <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p>Payouts post into <strong>platform cash</strong> on the mapped account. Principal reduces outstanding balance and closes the contract when paid off.</p>
          {nextEvent && <p className="mt-2">Next: <strong>{nextEvent.payoutDate}</strong> ({nextEvent.kind}, {nextEvent.amount} {nextEvent.currency})</p>}
        </div>
        <select className="select-base" value={investmentAccountId} onChange={(e) => setInvestmentAccountId(e.target.value)}>
          <option value="">Choose account…</option>
          {investmentAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="select-base" value={cadence} onChange={(e) => setCadence(e.target.value as SukukPayoutCadence)}>
          <option value="maturity_only">Bullet — pay at maturity</option>
          <option value="monthly">Monthly coupons (+ optional principal installments)</option>
          <option value="quarterly">Quarterly coupons (+ optional principal installments)</option>
        </select>
        {(cadence === 'monthly' || cadence === 'quarterly') && (
          <input className="input-base" type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} placeholder="Day of month (1-28)" />
        )}
        <div className="grid grid-cols-2 gap-3">
          <input className="input-base" type="number" min={0} step="any" value={couponAmount} onChange={(e) => setCouponAmount(e.target.value)} placeholder="Coupon per period" />
          <input className="input-base" type="number" min={0} step="any" value={principalInstallment} onChange={(e) => setPrincipalInstallment(e.target.value)} placeholder="Principal installment (optional)" />
        </div>
        <input className="input-base" type="number" min={0} step="any" value={principalAmount} onChange={(e) => setPrincipalAmount(e.target.value)} placeholder="Final principal at maturity (blank = remaining outstanding)" />
        {error && <div className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        <button disabled={isSaving} onClick={handleSave} className="w-full btn-primary">{isSaving ? 'Saving…' : 'Save schedule'}</button>
      </div>
    </Modal>
  );
};

export const SukukInvestmentsSection: React.FC = () => {
  const { data, addSukukPosition, updateSukukPosition, deleteSukukPosition, saveSukukPayoutSchedule } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editPosition, setEditPosition] = useState<SukukPosition | null>(null);
  const [schedulePosition, setSchedulePosition] = useState<SukukPosition | null>(null);

  const positions = useMemo(() => getPersonalSukukPositions(data), [data]);
  const filtered = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return [...positions]
      .filter((p) => {
        if (statusFilter === 'all') return true;
        const completed = p.status === 'completed' || (p.maturityDate && new Date(p.maturityDate).getTime() < now.getTime() && p.outstandingPrincipal <= 0);
        return statusFilter === 'completed' ? completed : !completed && p.status === 'active';
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [positions, statusFilter]);

  const schedules = data.sukukPayoutSchedules ?? [];
  const events = data.sukukPayoutEvents ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Direct Sukuk contracts</h2>
          <p className="text-sm text-slate-600 mt-1">Off-platform Sukuk with maturity dates and payout schedules. Broker Sukuk use Record Trade with asset class Sukuk.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="select-base text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => { setEditPosition(null); setModalOpen(true); }}>Add Sukuk</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-8 text-center">No Sukuk contracts in this view.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const schedule = schedules.find((s) => s.sukukPositionId === p.id) ?? null;
            const posEvents = events.filter((e) => e.sukukPositionId === p.id);
            const today = new Date().toISOString().slice(0, 10);
            const next = posEvents.filter((e) => !e.posted && e.payoutDate >= today).sort((a, b) => a.payoutDate.localeCompare(b.payoutDate))[0];
            return (
              <div key={p.id} className="section-card border-t-4 border-t-sky-500 p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BanknotesIcon className="h-7 w-7 text-sky-600 shrink-0" />
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate">{p.name}</h3>
                      <p className="text-xs text-slate-500">{p.status === 'completed' ? 'Completed' : 'Active'} · {p.issueDate} → {p.maturityDate}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className="p-2 text-slate-400 hover:text-primary" onClick={() => { setEditPosition(p); setModalOpen(true); }} aria-label="Edit"><PencilIcon className="h-4 w-4" /></button>
                    <button type="button" className="p-2 text-slate-400 hover:text-danger" onClick={() => void deleteSukukPosition(p.id)} aria-label="Delete"><TrashIcon className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-500">Outstanding</span><p className="font-semibold tabular-nums">{formatCurrencyString(p.outstandingPrincipal, { inCurrency: p.currency })}</p></div>
                  <div><span className="text-slate-500">Face value</span><p className="font-medium tabular-nums">{formatCurrencyString(p.faceValue, { inCurrency: p.currency })}</p></div>
                </div>
                {next && <p className="text-xs text-slate-700">Next payout: <strong>{next.payoutDate}</strong> ({next.kind}, {roundMoney(next.amount)} {next.currency})</p>}
                <button type="button" className="btn-secondary text-sm mt-auto" onClick={() => setSchedulePosition(p)}>
                  {schedule ? 'Edit payouts' : 'Set payouts'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <SukukPositionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        positionToEdit={editPosition}
        accounts={data.accounts ?? []}
        goals={data.goals ?? []}
        onSave={async (pos) => {
          if ('id' in pos && pos.id) await updateSukukPosition(pos as SukukPosition);
          else await addSukukPosition(pos as Omit<SukukPosition, 'id' | 'user_id'>);
        }}
      />
      {schedulePosition && (
        <SukukPayoutScheduleModal
          isOpen={!!schedulePosition}
          onClose={() => setSchedulePosition(null)}
          position={schedulePosition}
          accounts={data.accounts ?? []}
          existingSchedule={schedules.find((s) => s.sukukPositionId === schedulePosition.id) ?? null}
          existingEvents={events.filter((e) => e.sukukPositionId === schedulePosition.id)}
          onSave={async (input) => {
            await saveSukukPayoutSchedule({
              position: schedulePosition,
              existingSchedule: schedules.find((s) => s.sukukPositionId === schedulePosition.id) ?? null,
              ...input,
            });
          }}
        />
      )}
    </div>
  );
};

export default SukukInvestmentsSection;
