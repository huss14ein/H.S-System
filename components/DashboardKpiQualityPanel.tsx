import React, { useContext, useMemo, useEffect, useState } from 'react';
import SectionCard from './SectionCard';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { computeMonthlyReportFinancialKpis, computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import { reconcileDashboardVsSummaryKpis } from '../services/kpiReconciliation';
import {
    computeDashboardKpiSnapshot,
    computeDashboardValidationWarnings,
} from '../services/dashboardKpiSnapshot';
import { listRecentKpiReconciliationDrift, type KpiDriftEvent } from '../services/kpiDriftTelemetry';
import { useDashboardReconciliationPrefs } from '../hooks/useDashboardReconciliationPrefs';
import { useMarketData } from '../context/MarketDataContext';

/**
 * Dashboard validation, KPI reconciliation, and drift diagnostics — shown on System & APIs Health.
 */
const DashboardKpiQualityPanel: React.FC = () => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const { simulatedPrices } = useMarketData();
    const { formatCurrencyString } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);
    const { strictReconciliationMode, setStrictReconciliationMode, hardBlockOnMismatch, setHardBlockOnMismatch } =
        useDashboardReconciliationPrefs(auth?.user?.id);

    const kpiSnapshot = useMemo(
        () => computeDashboardKpiSnapshot(data, exchangeRate, getAvailableCashForAccount, simulatedPrices),
        [data, exchangeRate, getAvailableCashForAccount, simulatedPrices],
    );

    const dashboardValidationWarnings = useMemo(
        () => computeDashboardValidationWarnings(data, kpiSnapshot),
        [data, kpiSnapshot],
    );

    const summaryModelForReconciliation = useMemo(() => {
        if (!data) return null;
        return computeWealthSummaryReportModel(data, exchangeRate, getAvailableCashForAccount);
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const summaryMonthlyKpisForReconciliation = useMemo(() => {
        if (!data) return null;
        return computeMonthlyReportFinancialKpis(
            data,
            resolveSarPerUsd(data, exchangeRate),
            getAvailableCashForAccount,
            simulatedPrices,
        );
    }, [data, exchangeRate, getAvailableCashForAccount, simulatedPrices]);

    const kpiReconciliation = useMemo(() => {
        if (!summaryModelForReconciliation || !summaryMonthlyKpisForReconciliation || !kpiSnapshot) return null;
        return reconcileDashboardVsSummaryKpis({
            dashboard: {
                netWorth: kpiSnapshot.netWorth,
                monthlyPnL: kpiSnapshot.monthlyPnL,
                budgetVariance: kpiSnapshot.budgetVariance,
                roi: kpiSnapshot.roi,
                emergencyFundMonths: Number(emergencyFund.monthsCovered ?? 0),
            },
            summaryMetrics: summaryModelForReconciliation.financialMetricsWithEf,
            summaryMonthlyExtras: summaryMonthlyKpisForReconciliation,
        });
    }, [summaryModelForReconciliation, summaryMonthlyKpisForReconciliation, kpiSnapshot, emergencyFund.monthsCovered]);

    const [recentDriftEvents, setRecentDriftEvents] = useState<KpiDriftEvent[]>([]);
    const [isDriftEventsLoading, setIsDriftEventsLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const loadDriftEvents = async () => {
            setIsDriftEventsLoading(true);
            const events = await listRecentKpiReconciliationDrift(6);
            if (!cancelled) {
                setRecentDriftEvents(events);
                setIsDriftEventsLoading(false);
            }
        };
        void loadDriftEvents();
        const timer = window.setInterval(() => {
            void loadDriftEvents();
        }, 60000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [auth?.user?.id, strictReconciliationMode, hardBlockOnMismatch, kpiReconciliation?.mismatchCount]);

    if (!data) return null;

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Dashboard data quality and KPI checks</h2>
            <p className="text-xs text-slate-600">
                Validation and reconciliation tools were moved here so the main dashboard stays focused on decisions. Strict mode and hard-block
                prefs still apply to KPI cards on the Dashboard.
            </p>

            {dashboardValidationWarnings.length > 0 && (
                <SectionCard title="Dashboard validation checks" collapsible collapsibleSummary="Data quality and wiring checks" defaultExpanded>
                    <ul className="space-y-1 text-xs text-amber-800">
                        {dashboardValidationWarnings.slice(0, 12).map((w, i) => (
                            <li key={`warn-${i}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            <div
                className={`rounded-xl border p-3 ${strictReconciliationMode && kpiReconciliation && !kpiReconciliation.ok ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p className="text-sm font-semibold text-slate-900">KPI reconciliation mode</p>
                        <p className="text-xs text-slate-600">Strict cross-check: Dashboard vs Summary for shared KPI formulas.</p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={strictReconciliationMode}
                            onChange={(e) => setStrictReconciliationMode(e.target.checked)}
                            className="rounded border-slate-300 text-primary focus:ring-primary"
                        />
                        Strict mode
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={hardBlockOnMismatch}
                            onChange={(e) => setHardBlockOnMismatch(e.target.checked)}
                            className="rounded border-slate-300 text-primary focus:ring-primary"
                        />
                        Hard block on mismatch
                    </label>
                </div>
                {kpiReconciliation && (
                    <>
                        <p className={`mt-2 text-xs font-medium ${kpiReconciliation.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                            {kpiReconciliation.ok
                                ? 'All reconciled KPIs are within thresholds.'
                                : `${kpiReconciliation.mismatchCount} KPI mismatch(es) detected automatically.`}
                        </p>
                        <div className="mt-2 space-y-1.5">
                            {kpiReconciliation.rows.map((r) => (
                                <div
                                    key={r.key}
                                    className={`rounded-md border px-2.5 py-1.5 text-xs ${r.withinThreshold ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
                                >
                                    <span className="font-semibold">{r.label}:</span>{' '}
                                    Dashboard{' '}
                                    {r.key === 'investmentRoi'
                                        ? `${(r.dashboardValue * 100).toFixed(2)}%`
                                        : r.key === 'emergencyFundMonths'
                                          ? `${r.dashboardValue.toFixed(2)} mo`
                                          : formatCurrencyString(r.dashboardValue, { digits: 2 })}{' '}
                                    vs Summary{' '}
                                    {r.key === 'investmentRoi'
                                        ? `${(r.summaryValue * 100).toFixed(2)}%`
                                        : r.key === 'emergencyFundMonths'
                                          ? `${r.summaryValue.toFixed(2)} mo`
                                          : formatCurrencyString(r.summaryValue, { digits: 2 })}{' '}
                                    (delta{' '}
                                    {r.key === 'investmentRoi'
                                        ? `${(r.deltaAbs * 100).toFixed(2)}%`
                                        : r.key === 'emergencyFundMonths'
                                          ? `${r.deltaAbs.toFixed(2)} mo`
                                          : formatCurrencyString(r.deltaAbs, { digits: 2 })}
                                    , {(r.deltaPct * 100).toFixed(2)}%)
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <p className="text-sm font-semibold text-slate-900">KPI reconciliation drift (Dashboard)</p>
                        <p className="text-xs text-slate-600">Recent telemetry when strict mode finds mismatches</p>
                    </div>
                    {recentDriftEvents.length > 0 && (
                        <span
                            className={`text-xs font-semibold px-2 py-1 rounded-full ${recentDriftEvents.some((e) => e.mismatchCount > 0) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
                        >
                            {recentDriftEvents.some((e) => e.mismatchCount > 0) ? 'Attention' : 'Healthy'}
                        </span>
                    )}
                </div>
                {isDriftEventsLoading ? (
                    <p className="mt-2 text-xs text-slate-500">Loading diagnostics…</p>
                ) : recentDriftEvents.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No recent drift events logged.</p>
                ) : (
                    <div className="mt-2 space-y-1.5">
                        {recentDriftEvents.map((event, idx) => (
                            <div
                                key={`${event.at}-${idx}`}
                                className={`rounded-md border px-2.5 py-1.5 text-xs ${event.mismatchCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium">
                                        {new Date(event.at).toLocaleString()} • {event.page}
                                    </span>
                                    <span>
                                        mismatches: <strong>{event.mismatchCount}</strong>
                                    </span>
                                </div>
                                <div className="mt-0.5 text-[11px]">
                                    mode: {event.strictMode ? 'strict' : 'normal'} / {event.hardBlock ? 'hard-block' : 'warn-only'}
                                    {event.keys.length > 0 ? ` • keys: ${event.keys.join(', ')}` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {strictReconciliationMode && hardBlockOnMismatch && kpiReconciliation && !kpiReconciliation.ok && (
                <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3">
                    <p className="text-sm font-semibold text-red-800">Critical KPI mismatch detected</p>
                    <p className="text-xs text-red-700 mt-1">
                        Matching KPI cards on the Dashboard may be blocked. Resolve flagged rows above or relax hard-block in Settings.
                    </p>
                </div>
            )}
        </div>
    );
};

export default DashboardKpiQualityPanel;
