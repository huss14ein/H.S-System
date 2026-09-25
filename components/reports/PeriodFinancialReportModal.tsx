import React, { useCallback, useContext, useMemo, useState } from 'react';
import Modal from '../Modal';
import { DataContext } from '../../context/DataContext';
import { useMarketData } from '../../context/MarketDataContext';
import { useCanonicalSpotFx } from '../../hooks/useCanonicalFinancialMetrics';
import { useToast } from '../../context/ToastContext';
import {
  buildPeriodFinancialReportModel,
} from '../../services/periodFinancialReportModel';
import { generatePeriodFinancialReportHtml } from '../../services/periodFinancialReportHtml';
import {
  type PeriodReportPreset,
  validateCustomPeriodRange,
} from '../../services/periodReportWindow';
import { openHtmlForPrint } from '../../services/reportingEngine';

const PRESETS: Array<{ id: PeriodReportPreset; label: string }> = [
  { id: 'FY', label: 'Financial year' },
  { id: 'CY', label: 'Calendar year' },
  { id: 'YTD', label: 'Year to date' },
  { id: '12M', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom range' },
];

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
  const { simulatedPrices } = useMarketData();
  const sarPerUsd = useCanonicalSpotFx();
  const { showToast } = useToast();
  const [preset, setPreset] = useState<PeriodReportPreset>('YTD');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const previewLabel = useMemo(() => {
    try {
      const model = buildPeriodFinancialReportModel({
        data: data!,
        uiExchangeRate: sarPerUsd,
        getAvailableCashForAccount,
        simulatedPrices: simulatedPrices ?? {},
        preset,
        customStartIso: customStart,
        customEndIso: customEnd,
      });
      return model.twin.current.label;
    } catch {
      return '—';
    }
  }, [data, sarPerUsd, getAvailableCashForAccount, simulatedPrices, preset, customStart, customEnd]);

  const runPrint = useCallback(() => {
    if (!data) {
      showToast('Load your data first.', 'error');
      return;
    }
    if (preset === 'custom') {
      const v = validateCustomPeriodRange(customStart, customEnd);
      if (!v.ok) {
        setLastError(v.message);
        showToast(v.message, 'error');
        return;
      }
    }
    setLastError(null);
    setBusy(true);
    try {
      const model = buildPeriodFinancialReportModel({
        data,
        uiExchangeRate: sarPerUsd,
        getAvailableCashForAccount,
        simulatedPrices: simulatedPrices ?? {},
        preset,
        customStartIso: customStart,
        customEndIso: customEnd,
      });
      const html = generatePeriodFinancialReportHtml(model);
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
      setBusy(false);
    }
  }, [
    data,
    preset,
    customStart,
    customEnd,
    sarPerUsd,
    getAvailableCashForAccount,
    simulatedPrices,
    showToast,
  ]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Period Financial Report" maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Full-period extract across net worth, cashflow, budgets, portfolio P/L, cards, and more.
          Delivery is browser <strong>Print → Save as PDF</strong> (no binary PDF library).
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
              />
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Preview window: <span className="font-medium text-slate-700">{previewLabel}</span>
        </p>

        {lastError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {lastError}
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Close
          </button>
          {onNavigate && (
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => onNavigate('Wealth Analytics')}
            >
              Wealth Analytics
            </button>
          )}
          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={busy || !data}
            onClick={runPrint}
          >
            {busy ? 'Building…' : 'Print / Save as PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PeriodFinancialReportModal;
