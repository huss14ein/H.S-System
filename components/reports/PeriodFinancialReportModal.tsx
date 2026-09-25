import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import Modal from '../Modal';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import { useMarketData } from '../../context/MarketDataContext';
import { useCanonicalSpotFx } from '../../hooks/useCanonicalFinancialMetrics';
import { useToast } from '../../context/ToastContext';
import {
  PERIOD_REPORT_SECTION_OPTIONS,
  buildPeriodFinancialReportModel,
} from '../../services/periodFinancialReportModel';
import { generatePeriodFinancialReportHtml } from '../../services/periodFinancialReportHtml';
import {
  type PeriodReportPreset,
  resolvePeriodReportTwinWindows,
  validatePeriodReportRequest,
} from '../../services/periodReportWindow';
import { resolveMonthStartDayFromData } from '../../utils/financialMonth';
import { openHtmlForPrint } from '../../services/reportingEngine';
import {
  fetchPeriodReportInstallmentSnapshot,
  type PeriodReportInstallmentSnapshot,
} from '../../services/periodReportInstallments';
import { yieldToMain } from '../../utils/yieldToMain';

const PRESETS: Array<{ id: PeriodReportPreset; label: string }> = [
  { id: 'FY', label: 'Financial year' },
  { id: 'CY', label: 'Calendar year' },
  { id: 'YTD', label: 'Year to date' },
  { id: '12M', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom range' },
];

const LIVE_ACTIONS: Array<{ id: string; label: string; page: string; action?: string }> = [
  { id: 'open-summary', label: 'Summary', page: 'Summary' },
  { id: 'open-wealth-analytics', label: 'Wealth Analytics', page: 'Wealth Analytics' },
  { id: 'open-budgets', label: 'Budgets', page: 'Budgets' },
  { id: 'open-investments', label: 'Investments', page: 'Investments' },
  { id: 'open-subscriptions', label: 'Subscriptions', page: 'Subscriptions' },
  { id: 'open-installments', label: 'Installments', page: 'Installments' },
  { id: 'open-liabilities', label: 'Liabilities', page: 'Liabilities' },
  { id: 'open-settings-reports', label: 'Settings → Reports', page: 'Settings', action: 'open-period-financial-report' },
];

const DEFAULT_SECTIONS = Object.fromEntries(PERIOD_REPORT_SECTION_OPTIONS.map((s) => [s.id, true])) as Record<
  string,
  boolean
>;

export type PeriodFinancialReportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (page: string, action?: string) => void;
};

const PeriodFinancialReportModal: React.FC<PeriodFinancialReportModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { data, getAvailableCashForAccount } = useContext(DataContext)!;
  const auth = useContext(AuthContext);
  const { simulatedPrices } = useMarketData();
  const sarPerUsd = useCanonicalSpotFx();
  const { showToast } = useToast();
  const [preset, setPreset] = useState<PeriodReportPreset>('YTD');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, boolean>>(DEFAULT_SECTIONS);
  const [showSections, setShowSections] = useState(false);
  const [installmentSnap, setInstallmentSnap] = useState<PeriodReportInstallmentSnapshot | null>(null);
  const [installmentLoading, setInstallmentLoading] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInstallmentLoading(true);
    void fetchPeriodReportInstallmentSnapshot(auth?.user?.id).then((snap) => {
      if (cancelled) return;
      startTransition(() => {
        setInstallmentSnap(snap);
        setInstallmentLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, auth?.user?.id]);

  const previewLabel = useMemo(() => {
    try {
      const twin = resolvePeriodReportTwinWindows({
        preset,
        monthStartDay: resolveMonthStartDayFromData(data),
        customStartIso: customStart,
        customEndIso: customEnd,
      });
      return `${twin.current.label} · prior ${twin.prior.label}`;
    } catch {
      return '—';
    }
  }, [data, preset, customStart, customEnd]);

  const selectedSectionIds = useMemo(
    () => PERIOD_REPORT_SECTION_OPTIONS.filter((s) => sections[s.id]).map((s) => s.id),
    [sections],
  );

  const buildModel = useCallback(() => {
    if (!data) throw new Error('Load your data first.');
    return buildPeriodFinancialReportModel({
      data,
      uiExchangeRate: sarPerUsd,
      getAvailableCashForAccount,
      simulatedPrices: simulatedPrices ?? {},
      preset,
      customStartIso: customStart,
      customEndIso: customEnd,
      installmentSnapshot: installmentSnap,
      includeSectionIds: selectedSectionIds,
    });
  }, [
    data,
    sarPerUsd,
    getAvailableCashForAccount,
    simulatedPrices,
    preset,
    customStart,
    customEnd,
    installmentSnap,
    selectedSectionIds,
  ]);

  const validateBeforeRun = useCallback((): string | null => {
    const req = validatePeriodReportRequest({
      hasData: Boolean(data && ((data.accounts?.length ?? 0) > 0 || (data.transactions?.length ?? 0) > 0)),
      preset,
      customStartIso: customStart,
      customEndIso: customEnd,
    });
    if (!req.ok) return req.message;
    if (selectedSectionIds.length === 0) {
      return 'Select at least one report section.';
    }
    return null;
  }, [data, preset, customStart, customEnd, selectedSectionIds]);

  const runPrint = useCallback(async () => {
    if (busyRef.current) return;
    const validationError = validateBeforeRun();
    if (validationError) {
      setLastError(validationError);
      showToast(validationError, 'error');
      return;
    }
    setLastError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await yieldToMain(16);
      const model = buildModel();
      await yieldToMain(16);
      const html = generatePeriodFinancialReportHtml(model);
      await yieldToMain(0);
      const ok = openHtmlForPrint(html);
      if (!ok) {
        setLastError('Print window was blocked. Allow pop-ups for this site, then try again. This dialog stays open.');
        showToast('Print popup blocked — allow pop-ups and retry.', 'error');
        return;
      }
      showToast('Period report opened for Print / Save as PDF.', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to build period report';
      setLastError(msg);
      showToast(msg, 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [validateBeforeRun, buildModel, showToast]);

  const runJsonExport = useCallback(async () => {
    if (busyRef.current) return;
    const validationError = validateBeforeRun();
    if (validationError) {
      setLastError(validationError);
      showToast(validationError, 'error');
      return;
    }
    setLastError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await yieldToMain(16);
      const model = buildModel();
      const json = JSON.stringify(
        {
          generatedAtIso: model.generatedAtIso,
          window: {
            current: {
              label: model.twin.current.label,
              startIso: model.twin.current.startIso,
              endIso: model.twin.current.endIso,
              preset: model.twin.current.preset,
              finKeyCount: model.twin.current.finKeys.length,
            },
            prior: {
              label: model.twin.prior.label,
              startIso: model.twin.prior.startIso,
              endIso: model.twin.prior.endIso,
            },
          },
          sections: model.sections.map((s) => ({
            id: s.id,
            title: s.title,
            status: s.status,
            error: s.error ?? null,
            data: s.data ?? null,
          })),
          liveActions: model.liveActions,
        },
        null,
        2,
      );
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `finova-period-report-${model.twin.current.startIso}_${model.twin.current.endIso}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Period report JSON exported.', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to export period report JSON';
      setLastError(msg);
      showToast(msg, 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [validateBeforeRun, buildModel, showToast]);

  const toggleSection = (id: string) => {
    setSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const setAllSections = (on: boolean) => {
    setSections(Object.fromEntries(PERIOD_REPORT_SECTION_OPTIONS.map((s) => [s.id, on])));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Period Financial Report" maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Full-period extract across net worth, cashflow, budgets, portfolio P/L, cards, and more.
          Delivery is browser <strong>Print → Save as PDF</strong> (no binary PDF library), plus optional JSON.
          Balance-sheet KPIs are labeled as-of-today; cashflow, cards, portfolio P/L, and installment schedules follow the selected window.
        </p>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Period</label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`px-3 py-1.5 text-sm rounded-lg border ${
                  preset === p.id
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                onClick={() => setPreset(p.id)}
                disabled={busy}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {preset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="period-report-start">
                Start (YYYY-MM-DD)
              </label>
              <input
                id="period-report-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input-base w-full"
                disabled={busy}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="period-report-end">
                End (YYYY-MM-DD)
              </label>
              <input
                id="period-report-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input-base w-full"
                disabled={busy}
                required
              />
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Preview window: <span className="font-medium text-slate-700">{previewLabel}</span>
          {installmentLoading
            ? ' · Loading installment schedules…'
            : installmentSnap
              ? ` · ${installmentSnap.plans.length} installment plan(s)`
              : ''}
        </p>

        <div>
          <button
            type="button"
            className="text-sm text-primary font-medium hover:underline"
            onClick={() => setShowSections((v) => !v)}
          >
            {showSections ? 'Hide' : 'Choose'} sections ({selectedSectionIds.length}/{PERIOD_REPORT_SECTION_OPTIONS.length})
          </button>
          {showSections && (
            <div className="mt-2 rounded-lg border border-slate-200 p-3 space-y-2 max-h-48 overflow-y-auto">
              <div className="flex gap-2 mb-1">
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAllSections(true)}>
                  Select all
                </button>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAllSections(false)}>
                  Clear all
                </button>
              </div>
              {PERIOD_REPORT_SECTION_OPTIONS.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(sections[s.id])}
                    onChange={() => toggleSection(s.id)}
                    disabled={busy}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          )}
        </div>

        {lastError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
            {lastError}
          </div>
        )}

        {onNavigate && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Cross-engine actions</p>
            <div className="flex flex-wrap gap-2">
              {LIVE_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="btn-outline text-xs"
                  disabled={busy}
                  onClick={() => onNavigate(a.page, a.action)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button type="button" className="btn-outline text-sm" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="btn-outline text-sm disabled:opacity-50"
            disabled={busy || !data}
            onClick={() => void runJsonExport()}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={busy || !data}
            onClick={() => void runPrint()}
          >
            {busy ? 'Building…' : 'Print / Save as PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PeriodFinancialReportModal;
