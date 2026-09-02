import React, { useContext, useEffect, useMemo, useState } from 'react';
import { BanknotesIcon } from '../icons/BanknotesIcon';
import { PencilIcon } from '../icons/PencilIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type { Account, Goal, SukukPayoutCadence, SukukPayoutEvent, SukukPayoutSchedule, SukukPosition } from '../../types';
import Modal from '../Modal';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { parseMoneyInput, roundMoney } from '../../utils/money';
import { getPersonalSukukPositions } from '../../utils/wealthScope';
import RevaluationModal from '../reconciliation/RevaluationModal';
import {
  SUKUK_PAYOUT_CADENCE_OPTIONS,
  cadenceOptionDescription,
  cadenceOptionTitle,
  formatSukukPayoutCadenceLabel,
  formatSukukPayoutKindLabel,
} from '../../services/sukuk/sukukPayoutLabels';

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [key, value]) => s.split(`{${key}}`).join(String(value)),
    template,
  );
}

const SukukPositionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  positionToEdit: SukukPosition | null;
  accounts: Account[];
  goals: Goal[];
  onSave: (position: Omit<SukukPosition, 'id' | 'user_id'> | SukukPosition) => Promise<void>;
}> = ({ isOpen, onClose, positionToEdit, accounts, goals, onSave }) => {
  const { t, dir } = useLanguage();
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
      setError(t('sukukFaceValueError'));
      return;
    }
    if (!investmentAccountId) {
      setError(t('sukukChooseAccountError'));
      return;
    }
    if (!issueDate || !maturityDate) {
      setError(t('sukukDatesRequiredError'));
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
      setError(e instanceof Error ? e.message : t('sukukSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={positionToEdit ? t('sukukEditContract') : t('sukukAddContract')}>
      <div className="space-y-4" dir={dir}>
        <p className="text-sm text-slate-600 bg-sky-50 border border-sky-100 rounded-lg p-3">
          {t('sukukContractIntro')}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukContractName')}</span>
          <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sukukContractNamePlaceholder')} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukInvestmentAccount')}</span>
          <select className="select-base" value={investmentAccountId} onChange={(e) => setInvestmentAccountId(e.target.value)}>
            <option value="">{t('sukukChoosePlatformAccount')}</option>
            {investmentAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukCurrency')}</span>
          <select className="select-base" value={currency} onChange={(e) => setCurrency(e.target.value as 'SAR' | 'USD')}>
            <option value="SAR">SAR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukFaceValueOriginal')}</span>
          <input className="input-base" type="number" min={0} step="any" value={faceValue} onChange={(e) => setFaceValue(e.target.value)} disabled={!!positionToEdit} inputMode="decimal" />
        </label>
        {positionToEdit ? (
          <p className="text-xs text-slate-500 -mt-2">
            {t('sukukFaceLockedHint')}
          </p>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukPurchasePrice')}</span>
          <input className="input-base" type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} inputMode="decimal" />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-800">{t('sukukIssueDate')}</span>
            <input className="input-base" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-800">{t('sukukMaturityDate')}</span>
            <input className="input-base" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukLinkedGoal')}</span>
          <select className="select-base" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">{t('sukukNoGoalLink')}</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukNotesOptional')}</span>
          <textarea className="input-base min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <div className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        <button disabled={isSaving} onClick={handleSave} className="w-full btn-primary">{isSaving ? t('sukukPayoutSaving') : t('sukukSave')}</button>
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
  const { t, language, dir } = useLanguage();
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

  const periodic = cadence === 'monthly' || cadence === 'quarterly';
  const currencyLabel = currency === 'USD' ? 'USD' : 'SAR';

  const nextEvent = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (existingEvents || [])
      .filter((e) => !e.posted && e.payoutDate >= today)
      .sort((a, b) => a.payoutDate.localeCompare(b.payoutDate))[0] ?? null;
  }, [existingEvents]);

  const scheduleSummary = useMemo(() => {
    const parts: string[] = [formatSukukPayoutCadenceLabel(cadence, language)];
    if (periodic) {
      const day = Math.max(1, Math.min(28, Math.trunc(Number(dayOfMonth || '1')) || 1));
      parts.push(fillTemplate(t('sukukPayoutSummaryOnDay'), { day }));
    }
    const coupon = couponAmount.trim() === '' ? null : parseMoneyInput(couponAmount);
    if (coupon != null && coupon > 0) {
      parts.push(
        fillTemplate(
          t(periodic ? 'sukukPayoutSummaryProfitEach' : 'sukukPayoutSummaryProfitMaturity'),
          { amount: coupon, currency: currencyLabel },
        ),
      );
    }
    const installment = principalInstallment.trim() === '' ? null : parseMoneyInput(principalInstallment);
    if (periodic && installment != null && installment > 0) {
      parts.push(
        fillTemplate(t('sukukPayoutSummaryCapitalEach'), {
          amount: installment,
          currency: currencyLabel,
        }),
      );
    }
    const finalPrincipal = principalAmount.trim() === '' ? null : parseMoneyInput(principalAmount);
    if (finalPrincipal != null && finalPrincipal > 0) {
      parts.push(
        fillTemplate(t('sukukPayoutSummaryCapitalMaturity'), {
          amount: finalPrincipal,
          currency: currencyLabel,
        }),
      );
    } else {
      parts.push(t('sukukPayoutSummaryRemainingCapital'));
    }
    return parts.join(' · ');
  }, [cadence, periodic, dayOfMonth, couponAmount, principalInstallment, principalAmount, currencyLabel, language, t]);

  const handleSave = async () => {
    setError(null);
    if (!investmentAccountId) {
      setError(t('sukukPayoutChooseAccountError'));
      return;
    }
    const dom = Math.max(1, Math.min(28, Math.trunc(Number(dayOfMonth || '1'))));
    const coupon = couponAmount.trim() === '' ? null : parseMoneyInput(couponAmount);
    const principal = principalAmount.trim() === '' ? null : parseMoneyInput(principalAmount);
    const principalInst = periodic
      ? (principalInstallment.trim() === '' ? null : parseMoneyInput(principalInstallment))
      : null;

    setIsSaving(true);
    try {
      await onSave({
        investmentAccountId,
        currency,
        cadence,
        dayOfMonth: periodic ? dom : null,
        couponAmount: coupon,
        principalAmount: principal,
        principalInstallmentAmount: principalInst,
        startDate: startDate || null,
        endDate: endDate || null,
        enabled,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sukukPayoutSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const radioAlign = language === 'ar' ? 'text-right' : 'text-left';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('sukukPayoutHowPaid')}>
      <div className="space-y-5" dir={dir}>
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-900">{position.name}</p>
          <p className="text-sm text-slate-600">
            {t('sukukPayoutIntro')}
          </p>
          {nextEvent && (
            <p className="text-xs text-slate-600 pt-1">
              {t('sukukPayoutNextScheduled')}: <strong>{nextEvent.payoutDate}</strong>
              {' · '}
              {formatSukukPayoutKindLabel(nextEvent.kind, language)}
              {' · '}
              {roundMoney(nextEvent.amount)} {nextEvent.currency}
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">{t('sukukPayoutCashLandsIn')}</span>
          <select
            className="select-base"
            value={investmentAccountId}
            onChange={(e) => setInvestmentAccountId(e.target.value)}
            aria-label={t('sukukPayoutAccountAria')}
          >
            <option value="">{t('sukukPayoutChooseAccount')}</option>
            {investmentAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">{t('sukukPayoutAccountHint')}</span>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">{t('sukukPayoutFrequency')}</legend>
          <div className="space-y-2" role="radiogroup" aria-label={t('sukukPayoutFrequency')}>
            {SUKUK_PAYOUT_CADENCE_OPTIONS.map((option) => {
              const selected = cadence === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setCadence(option.value)}
                  className={`w-full ${radioAlign} rounded-xl border px-3 py-3 transition-colors ${
                    selected
                      ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? 'border-sky-600 bg-sky-600' : 'border-slate-300 bg-white'
                      }`}
                      aria-hidden
                    >
                      {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{cadenceOptionTitle(option, language)}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{cadenceOptionDescription(option, language)}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {periodic && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-800">{t('sukukPayoutPaymentDay')}</span>
            <input
              className="input-base"
              type="number"
              min={1}
              max={28}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              inputMode="numeric"
            />
            <span className="text-xs text-slate-500">{t('sukukPayoutPaymentDayHint')}</span>
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">
            {fillTemplate(
              t(periodic ? 'sukukPayoutProfitEach' : 'sukukPayoutProfitMaturity'),
              { currency: currencyLabel },
            )}
          </span>
          <input
            className="input-base"
            type="number"
            min={0}
            step="any"
            value={couponAmount}
            onChange={(e) => setCouponAmount(e.target.value)}
            placeholder="0"
            inputMode="decimal"
          />
          <span className="text-xs text-slate-500">
            {t(periodic ? 'sukukPayoutProfitEachHint' : 'sukukPayoutProfitMaturityHint')}
          </span>
        </label>

        {periodic && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-800">
              {fillTemplate(t('sukukPayoutCapitalEach'), { currency: currencyLabel })}
            </span>
            <input
              className="input-base"
              type="number"
              min={0}
              step="any"
              value={principalInstallment}
              onChange={(e) => setPrincipalInstallment(e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
            <span className="text-xs text-slate-500">
              {t('sukukPayoutCapitalEachHint')}
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">
            {fillTemplate(t('sukukPayoutCapitalMaturity'), { currency: currencyLabel })}
          </span>
          <input
            className="input-base"
            type="number"
            min={0}
            step="any"
            value={principalAmount}
            onChange={(e) => setPrincipalAmount(e.target.value)}
            placeholder={t('sukukPayoutCapitalMaturityPlaceholder')}
            inputMode="decimal"
          />
          <span className="text-xs text-slate-500">
            {fillTemplate(t('sukukPayoutCapitalMaturityHint'), {
              date: position.maturityDate || t('sukukPayoutMaturityFallback'),
            })}
          </span>
        </label>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('sukukPayoutSummary')}</p>
          <p className="mt-1 leading-relaxed">{scheduleSummary}</p>
        </div>

        {error && <div className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        <button disabled={isSaving} onClick={handleSave} className="w-full btn-primary">
          {isSaving ? t('sukukPayoutSaving') : t('sukukPayoutSave')}
        </button>
      </div>
    </Modal>
  );
};

export const SukukInvestmentsSection: React.FC = () => {
  const {
    data,
    addSukukPosition,
    updateSukukPosition,
    deleteSukukPosition,
    saveSukukPayoutSchedule,
    applyReconciliationAdjustment,
  } = useContext(DataContext)!;
  const auth = useContext(AuthContext);
  const { t, language } = useLanguage();
  const canRestate = String(auth?.userRole ?? '').trim().toLowerCase() !== 'restricted';
  const { formatCurrencyString } = useFormatCurrency();
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editPosition, setEditPosition] = useState<SukukPosition | null>(null);
  const [restatePosition, setRestatePosition] = useState<SukukPosition | null>(null);
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
    <div className="space-y-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('sukukSectionTitle')}</h2>
          <p className="text-sm text-slate-600 mt-1">
            {t('sukukSectionSubtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="select-base text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">{t('sukukFilterActive')}</option>
            <option value="completed">{t('sukukFilterCompleted')}</option>
            <option value="all">{t('sukukFilterAll')}</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => { setEditPosition(null); setModalOpen(true); }}>{t('sukukAdd')}</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-8 text-center space-y-2">
          <p>{t('sukukEmpty')}</p>
          {positions.length > 0 && statusFilter === 'active' && (
            <p className="text-xs text-slate-600">
              {positions.length - filtered.length > 0
                ? fillTemplate(t('sukukEmptyCompletedHint'), { count: positions.length - filtered.length })
                : t('sukukEmptyTryAll')}
            </p>
          )}
        </div>
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
                      <p className="text-xs text-slate-500">{p.status === 'completed' ? t('sukukStatusCompleted') : t('sukukStatusActive')} · {p.issueDate} → {p.maturityDate}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className="p-2 text-slate-400 hover:text-primary" onClick={() => { setEditPosition(p); setModalOpen(true); }} aria-label={t('sukukEditAria')}><PencilIcon className="h-4 w-4" /></button>
                    <button type="button" className="p-2 text-slate-400 hover:text-danger" onClick={() => void deleteSukukPosition(p.id)} aria-label={t('sukukDeleteAria')}><TrashIcon className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-500">{t('sukukOutstanding')}</span><p className="font-semibold tabular-nums">{formatCurrencyString(p.outstandingPrincipal, { inCurrency: p.currency })}</p></div>
                  <div><span className="text-slate-500">{t('sukukFaceValue')}</span><p className="font-medium tabular-nums">{formatCurrencyString(p.faceValue, { inCurrency: p.currency })}</p></div>
                </div>
                {canRestate && (
                <button
                  type="button"
                  className="self-start px-2 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50"
                  onClick={() => setRestatePosition(p)}
                >
                  {t('sukukPayoutCorrectOutstanding')}
                </button>
                )}
                {next && (
                  <p className="text-xs text-slate-700">
                    {t('sukukPayoutNextPayout')}: <strong>{next.payoutDate}</strong>
                    {' · '}
                    {formatSukukPayoutKindLabel(next.kind, language)}
                    {' · '}
                    {roundMoney(next.amount)} {next.currency}
                  </p>
                )}
                <button type="button" className="btn-secondary text-sm mt-auto" onClick={() => setSchedulePosition(p)}>
                  {schedule ? t('sukukPayoutEditHowPaid') : t('sukukPayoutSetHowPaid')}
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
      <RevaluationModal
        isOpen={!!restatePosition}
        onClose={() => setRestatePosition(null)}
        title={`${t('sukukPayoutCorrectOutstanding')} — ${restatePosition?.name ?? ''}`}
        entityType="sukuk_position"
        entityId={restatePosition?.id ?? ''}
        entityLabel={restatePosition?.name ?? t('sukukNoun')}
        beforeValue={Number(restatePosition?.outstandingPrincipal ?? 0)}
        currency={restatePosition?.currency === 'USD' ? 'USD' : 'SAR'}
        maxValue={Number(restatePosition?.faceValue ?? 0)}
        onApply={async ({ entityId, actualValue, reason }) => {
          const result = await applyReconciliationAdjustment({
            mechanism: 'sukuk_face_yield',
            entityType: 'sukuk_position',
            entityId,
            actualValue,
            reason,
          });
          if (!result.ok) throw new Error(result.error || t('sukukCorrectFailed'));
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
