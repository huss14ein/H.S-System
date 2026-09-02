import React, { startTransition, useContext, useEffect, useState } from 'react';
import Modal from '../Modal';
import { DataContext } from '../../context/DataContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useToast } from '../../context/ToastContext';
import { useCanonicalFinancialMetrics } from '../../hooks/useCanonicalFinancialMetrics';
import { useMarketData } from '../../context/MarketDataContext';
import {
  buildPeriodFinancialReportModel,
  type BuildPeriodFinancialReportModelArgs,
} from '../../services/periodFinancialReportModel';
import {
  generatePeriodFinancialReportHtml,
  periodReportTransactionsCsv,
} from '../../services/periodFinancialReportHtml';
import { openHtmlForPrint } from '../../services/reportingEngine';
import type { PeriodReportPreset } from '../../services/periodReportWindow';
import { listNetWorthSnapshots } from '../../services/netWorthSnapshot';

export const PERIOD_REPORT_OPEN_EVENT = 'finova:open-period-financial-report';

export function openPeriodFinancialReportModal(): void {
  try {
    window.dispatchEvent(new CustomEvent(PERIOD_REPORT_OPEN_EVENT));
  } catch {
    // ignore
  }
}

const PRESETS: { value: PeriodReportPreset; label: string }[] = [
  { value: 'financial_year', label: 'Financial year' },
  { value: 'calendar_year', label: 'Calendar year' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_12m', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom range' },
];

export const PeriodFinancialReportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const dataCtx = useContext(DataContext);
  const { exchangeRate } = useCurrency();
  const { showToast } = useToast();
  const { simulatedPrices, lastUpdated } = useMarketData();
  const metrics = useCanonicalFinancialMetrics();
  const [preset, setPreset] = useState<PeriodReportPreset>('financial_year');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [busy, setBusy] = useState(false);

  const getAvailableCashForAccount =
    dataCtx?.getAvailableCashForAccount ??
    (() => ({ SAR: 0, USD: 0 }));

  const runReport = (alsoCsv: boolean) => {
    const data = dataCtx?.data;
    if (!data) {
      showToast('Load workspace data before generating the report.', 'warning');
      return;
    }
    setBusy(true);
    startTransition(() => {
      try {
        const args: BuildPeriodFinancialReportModelArgs = {
          data,
          exchangeRate,
          getAvailableCashForAccount,
          simulatedPrices: simulatedPrices ?? {},
          preset,
          customStart: preset === 'custom' ? customStart || undefined : undefined,
          customEnd: preset === 'custom' ? customEnd || undefined : undefined,
          quotesAsOf: lastUpdated ? new Date(lastUpdated).toISOString() : null,
          snapshots: listNetWorthSnapshots(),
        };
        const model = buildPeriodFinancialReportModel(args);
        const html = generatePeriodFinancialReportHtml(model);
        const ok = openHtmlForPrint(html);
        if (!ok) {
          showToast('Could not open print preview — check browser pop-up settings.', 'error');
        } else {
          showToast('Period financial report opened for Print / Save as PDF.', 'success');
        }
        if (alsoCsv) {
          const csv = periodReportTransactionsCsv(model);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `finova-period-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(a.href);
        }
        onClose();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to build period report.', 'error');
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Period financial report" maxWidthClass="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Full-system report for the selected period: wealth, cashflow, budgets, transactions, investments,
          Sukuk, debt, safety, goals, Zakat, and recommendations. Opens a print-ready PDF preview.
        </p>
        <p className="text-xs text-slate-500">
          FX {Number(metrics.sarPerUsd).toFixed(4)} SAR/USD · NW {Math.round(metrics.netWorth).toLocaleString()} SAR
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">Period</span>
          <select
            className="select-base"
            value={preset}
            onChange={(e) => setPreset(e.target.value as PeriodReportPreset)}
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-800">Start</span>
              <input className="input-base" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-800">End</span>
              <input className="input-base" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </label>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => runReport(false)}>
            {busy ? 'Building…' : 'Generate PDF'}
          </button>
          <button type="button" className="btn-outline flex-1" disabled={busy} onClick={() => runReport(true)}>
            PDF + transactions CSV
          </button>
        </div>
      </div>
    </Modal>
  );
};

/** Global host — mount once under Data/Market providers; open via {@link openPeriodFinancialReportModal}. */
export const PeriodFinancialReportHost: React.FC = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(PERIOD_REPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PERIOD_REPORT_OPEN_EVENT, onOpen);
  }, []);
  return <PeriodFinancialReportModal isOpen={open} onClose={() => setOpen(false)} />;
};

export default PeriodFinancialReportModal;
