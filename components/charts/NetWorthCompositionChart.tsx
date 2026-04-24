import React, { useState, useMemo, useContext, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush } from 'recharts';
import { DataContext } from '../../context/DataContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';
import { useCurrency } from '../../context/CurrencyContext';
import { hydrateSarPerUsdDailySeries, getSarPerUsdForCalendarDay } from '../../services/fxDailySeries';
import { computePersonalNetWorthChartBucketsSAR } from '../../services/personalNetWorth';
import {
    listNetWorthSnapshots,
    NW_BUCKETS_SCHEMA_LEGACY,
    NW_BUCKETS_SCHEMA_V2,
} from '../../services/netWorthSnapshot';
import { bucketSumMatchesNetWorth, logNetWorthSnapshotDriftInDev } from '../../services/netWorthReconciliation';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../../services/transactionFilters';
import InfoHint from '../InfoHint';

type TimePeriod = 'Day' | 'Week' | 'Month' | '6M' | '1Y' | '3Y' | 'All';

const PERIOD_LABELS: Record<TimePeriod, string> = {
  Day: 'Day',
  Week: 'Week',
  Month: 'Month',
  '6M': '6 mo',
  '1Y': '1Y',
  '3Y': '3Y',
  All: 'All',
};

const RECEIVABLES_COLOR = CHART_COLORS.categorical[1];

type DailyNwRow = {
  date: string;
  dayKey: string;
  name: string;
  'Net Worth': number;
  Cash: number;
  Investments: number;
  Physical: number;
  Receivables: number;
  Liabilities: number;
};

function monthKeyFromDate(input: string | Date): string {
    const d = new Date(input);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromKey(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** Local calendar YYYY-MM-DD for grouping snapshot instants. */
function localDayKeyFromInstant(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function localTodayKey(): string {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, '0');
    const day = String(n.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseLocalDayKey(dayKey: string): Date {
    const [y, m, d] = dayKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function shortDayLabel(dayKey: string): string {
    const t = parseLocalDayKey(dayKey);
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function positiveAssetStackTotal(row: Pick<DailyNwRow, 'Cash' | 'Investments' | 'Physical' | 'Receivables'>): number {
    return Math.max(0, row.Cash) + Math.max(0, row.Investments) + Math.max(0, row.Physical) + Math.max(0, row.Receivables);
}

function NetWorthStackTooltip(props: {
    active?: boolean;
    payload?: Array<{ payload?: DailyNwRow }>;
    label?: string;
    formatValue: (n: number) => string;
}) {
    const { active, payload, label, formatValue } = props;
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as DailyNwRow | undefined;
    if (!row) return null;
    const nw = Number(row['Net Worth']) || 0;
    const assetTotal = positiveAssetStackTotal(row);
    const rows = [
        { key: 'Cash', label: 'Cash', value: row.Cash, color: CHART_COLORS.primary },
        { key: 'Investments', label: 'Investments', value: row.Investments, color: CHART_COLORS.secondary },
        { key: 'Physical', label: 'Physical & commodities', value: row.Physical, color: CHART_COLORS.tertiary },
        { key: 'Receivables', label: 'Receivables', value: row.Receivables, color: RECEIVABLES_COLOR },
        { key: 'Liabilities', label: 'Debt', value: row.Liabilities, color: CHART_COLORS.liability },
    ];
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg text-xs min-w-[200px]">
            <p className="font-semibold text-slate-800 mb-1">{label}</p>
            <p className="text-slate-600 mb-2 tabular-nums">
                Net worth: <span className="font-semibold text-slate-900">{formatValue(nw)}</span>
            </p>
            <ul className="space-y-1">
                {rows.map((r) => {
                    const v = Number(r.value) || 0;
                    if (Math.abs(v) < 0.5) return null;
                    const pct = assetTotal > 0 && r.key !== 'Liabilities' ? (Math.max(0, v) / assetTotal) * 100 : null;
                    return (
                        <li key={r.key} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: r.color }} />
                                <span className="text-slate-600 truncate">{r.label}</span>
                            </span>
                            <span className="tabular-nums text-slate-800 shrink-0">
                                {formatValue(v)}
                                {pct != null && Number.isFinite(pct) ? <span className="text-slate-400 ml-1">({pct.toFixed(1)}%)</span> : null}
                            </span>
                        </li>
                    );
                })}
            </ul>
            <p className="mt-2 text-[10px] text-slate-400 leading-snug">Percentages are shares of the positive asset stack (cash through receivables). Debt is shown on a separate signed stack.</p>
        </div>
    );
}

function startOfLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Rolling calendar windows from start of today (local). */
function filterRowsByTimePeriod(rows: DailyNwRow[], period: TimePeriod): DailyNwRow[] {
    if (period === 'All') return rows;
    const todayStart = startOfLocalDay(new Date());
    const cutoff = new Date(todayStart);
    switch (period) {
        case 'Day':
            cutoff.setDate(cutoff.getDate() - 1);
            break;
        case 'Week':
            cutoff.setDate(cutoff.getDate() - 7);
            break;
        case 'Month':
            cutoff.setDate(cutoff.getDate() - 30);
            break;
        case '6M':
            cutoff.setMonth(cutoff.getMonth() - 6);
            break;
        case '1Y':
            cutoff.setFullYear(cutoff.getFullYear() - 1);
            break;
        case '3Y':
            cutoff.setFullYear(cutoff.getFullYear() - 3);
            break;
        default:
            return rows;
    }
    return rows.filter((r) => parseLocalDayKey(r.dayKey) >= cutoff);
}

type SeriesVisibility = Record<'Cash' | 'Investments' | 'Physical' | 'Receivables' | 'Liabilities', boolean>;

const SERIES_DEFAULT: SeriesVisibility = {
    Cash: true,
    Investments: true,
    Physical: true,
    Receivables: true,
    Liabilities: true,
};

const LEGACY_SCHEMA_BANNER_KEY = 'finova_nw_legacy_schema_banner_dismissed';

const NetWorthCompositionChart: React.FC<{ title: string; onOpenSummary?: () => void }> = ({ title, onOpenSummary }) => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('All');
    /** When snapshots are sparse, optionally build a 12‑month line from ledger cashflow (can diverge from true balance‑sheet NW). */
    const [useLedgerEstimateWhenSparse, setUseLedgerEstimateWhenSparse] = useState(true);
    const [seriesVisible, setSeriesVisible] = useState<SeriesVisibility>(() => ({ ...SERIES_DEFAULT }));
    const [legacySchemaBannerDismissed, setLegacySchemaBannerDismissed] = useState(() => {
        try {
            return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(LEGACY_SCHEMA_BANNER_KEY) === '1';
        } catch {
            return false;
        }
    });

    const chartData = useMemo(() => {
        if (!data) return [];
        const snapshots = listNetWorthSnapshots();
        const oldestDay = snapshots.reduce<string | undefined>((min, s) => {
            const d = typeof s.at === 'string' ? s.at.slice(0, 10) : '';
            if (d.length !== 10) return min;
            if (!min || d < min) return d;
            return min;
        }, undefined);
        hydrateSarPerUsdDailySeries(data, exchangeRate, {
            horizonDays: 4000,
            earliestCalendarDay: oldestDay,
        });
        const todayKey = new Date().toISOString().slice(0, 10);
        const fxToday = getSarPerUsdForCalendarDay(todayKey, data, exchangeRate);
        const buckets = computePersonalNetWorthChartBucketsSAR(data, fxToday, { getAvailableCashForAccount });
        const byLocalDay = new Map<string, {
            date: string;
            netWorth: number;
            cash: number;
            investments: number;
            physical: number;
            receivables: number;
            liabilities: number;
        }>();

        snapshots.forEach((s) => {
            const dayKey = localDayKeyFromInstant(s.at);
            const existing = byLocalDay.get(dayKey);
            if (existing && existing.date >= s.at) return;
            const b = s.buckets;
            const hasBuckets = !!b;
            byLocalDay.set(dayKey, {
                date: s.at,
                netWorth: Number(s.netWorth) || 0,
                cash: hasBuckets ? (Number(b!.cash) || 0) : 0,
                investments: hasBuckets ? (Number(b!.investments) || 0) : 0,
                physical: hasBuckets ? (Number(b!.physicalAndCommodities) || 0) : 0,
                receivables: hasBuckets ? (Number(b!.receivables) || 0) : 0,
                liabilities: hasBuckets ? (Number(b!.liabilities) || 0) : 0,
            });
        });

        const todayLocal = localTodayKey();
        const currentDate = new Date().toISOString();
        byLocalDay.set(todayLocal, {
            date: currentDate,
            netWorth: Math.round(buckets.netWorth),
            cash: Math.round(buckets.cash),
            investments: Math.round(buckets.investments),
            physical: Math.round(buckets.physicalAndCommodities),
            receivables: Math.round(buckets.receivables),
            liabilities: Math.round(buckets.liabilities),
        });

        let finalData: DailyNwRow[] = Array.from(byLocalDay.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([dayKey, x]) => ({
                date: x.date,
                dayKey,
                name: shortDayLabel(dayKey),
                'Net Worth': Math.round(x.netWorth),
                Cash: Math.round(x.cash),
                Investments: Math.round(x.investments),
                Physical: Math.round(x.physical),
                Receivables: Math.round(x.receivables),
                Liabilities: Math.round(x.liabilities),
            }));

        // If snapshots are sparse, optionally synthesize a monthly line from ledger cashflow (cashflow-only; not full NW).
        if (useLedgerEstimateWhenSparse && finalData.length < 2) {
            const txs = data.transactions ?? [];
            const now = new Date();
            const keys: string[] = [];
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                keys.push(monthKeyFromDate(d));
            }
            const netByMonth = new Map<string, number>(keys.map((k) => [k, 0]));
            for (const t of txs) {
                const k = monthKeyFromDate(t.date);
                if (!netByMonth.has(k)) continue;
                const amt = Number(t.amount) || 0;
                if (countsAsIncomeForCashflowKpi(t)) netByMonth.set(k, (netByMonth.get(k) || 0) + Math.max(0, amt));
                if (countsAsExpenseForCashflowKpi(t)) netByMonth.set(k, (netByMonth.get(k) || 0) - Math.abs(amt));
            }
            const monthFlows = keys.map((k) => netByMonth.get(k) || 0);
            const currentNw = Math.round(Number(buckets.netWorth) || 0);
            const startNw = Math.round(currentNw - monthFlows.reduce((a, b) => a + b, 0));
            let rolling = startNw;
            finalData = keys.map((k, idx) => {
                rolling += monthFlows[idx] || 0;
                const netWorth = Math.round(rolling);
                const dayKey = `${k}-01`;
                return {
                    date: `${k}-01T12:00:00.000Z`,
                    dayKey,
                    name: monthLabelFromKey(k),
                    'Net Worth': netWorth,
                    Cash: netWorth,
                    Investments: 0,
                    Physical: 0,
                    Receivables: 0,
                    Liabilities: 0,
                };
            });
        }

        return filterRowsByTimePeriod(finalData, timePeriod);
    }, [data, timePeriod, exchangeRate, getAvailableCashForAccount, useLedgerEstimateWhenSparse]);

    const liveBuckets = useMemo(() => {
        if (!data) return null;
        hydrateSarPerUsdDailySeries(data, exchangeRate, { horizonDays: 4000 });
        const todayKey = new Date().toISOString().slice(0, 10);
        const fxToday = getSarPerUsdForCalendarDay(todayKey, data, exchangeRate);
        return computePersonalNetWorthChartBucketsSAR(data, fxToday, { getAvailableCashForAccount });
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const snapshotSchemaMix = useMemo(() => {
        const snaps = listNetWorthSnapshots();
        const withBuckets = snaps.filter((s) => s.buckets);
        let legacy = 0;
        let v2 = 0;
        for (const s of withBuckets) {
            const ver = s.bucketsSchemaVersion ?? NW_BUCKETS_SCHEMA_LEGACY;
            if (ver >= NW_BUCKETS_SCHEMA_V2) v2 += 1;
            else legacy += 1;
        }
        return { legacy, v2, total: withBuckets.length };
    }, [chartData.length, data, liveBuckets?.netWorth]);

    useEffect(() => {
        if (!import.meta.env.DEV || !liveBuckets) return;
        logNetWorthSnapshotDriftInDev(listNetWorthSnapshots());
        const r = bucketSumMatchesNetWorth({
            netWorth: liveBuckets.netWorth,
            buckets: {
                cash: liveBuckets.cash,
                investments: liveBuckets.investments,
                physicalAndCommodities: liveBuckets.physicalAndCommodities,
                receivables: liveBuckets.receivables,
                liabilities: liveBuckets.liabilities,
            },
        });
        if (!r.matches) {
            console.warn('[Finova NW reconcile] Live books bucket sum vs netWorth drift', r.driftSar.toFixed(2), 'SAR');
        }
    }, [liveBuckets]);

    const isEmpty = !chartData?.length;
    const showBrush = chartData.length > 10;
    const liveReconcile = liveBuckets
        ? bucketSumMatchesNetWorth({
              netWorth: liveBuckets.netWorth,
              buckets: {
                  cash: liveBuckets.cash,
                  investments: liveBuckets.investments,
                  physicalAndCommodities: liveBuckets.physicalAndCommodities,
                  receivables: liveBuckets.receivables,
                  liabilities: liveBuckets.liabilities,
              },
          })
        : null;

    return (
        <div className="h-full flex flex-col min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4 min-w-0">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold text-dark inline-flex items-center gap-1.5 flex-wrap">
                            {title}
                            <InfoHint
                                placement="bottom"
                                text="Filters use your local calendar: Day ≈ yesterday–today, Week = today and the prior 7 days, Month = last 31 days. Longer ranges cut off from the start of today. Data comes from one snapshot per day (when you use the app) plus today’s live books. Sukuk recorded under Assets is included in the Investments band (same as the Investments page)."
                            />
                        </h3>
                        {onOpenSummary && (
                            <button
                                type="button"
                                onClick={onOpenSummary}
                                className="shrink-0 text-xs font-semibold text-primary hover:text-secondary underline-offset-2 hover:underline"
                            >
                                Full Summary →
                            </button>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 max-w-xl">
                        Snapshots keep one row per <strong>calendar day</strong> (local time) with the same bucket model as your dashboard; today is always refreshed from live data. Sparse history can use a <strong>ledger cashflow estimate</strong> (monthly-only trend—not true daily net worth).
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">
                            Live buckets · schema v{NW_BUCKETS_SCHEMA_V2}
                        </span>
                        {snapshotSchemaMix.total > 0 && (
                            <>
                                {snapshotSchemaMix.v2 > 0 && (
                                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                        Saved v{NW_BUCKETS_SCHEMA_V2}: {snapshotSchemaMix.v2}
                                    </span>
                                )}
                                {snapshotSchemaMix.legacy > 0 && (
                                    <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                                        Legacy v{NW_BUCKETS_SCHEMA_LEGACY}: {snapshotSchemaMix.legacy}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            className="rounded border-slate-300 text-primary focus:ring-primary"
                            checked={useLedgerEstimateWhenSparse}
                            onChange={(e) => setUseLedgerEstimateWhenSparse(e.target.checked)}
                        />
                        Use ledger cashflow estimate when history is sparse (fewer than two months)
                    </label>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Layers</span>
                        {(Object.keys(SERIES_DEFAULT) as (keyof SeriesVisibility)[]).map((key) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setSeriesVisible((prev) => ({ ...prev, [key]: !prev[key] }))}
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                                    seriesVisible[key]
                                        ? 'border-slate-300 bg-white text-slate-800 shadow-sm'
                                        : 'border-transparent bg-slate-100 text-slate-400 line-through'
                                }`}
                            >
                                {key === 'Physical' ? 'Physical & comm.' : key === 'Liabilities' ? 'Debt' : key}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setSeriesVisible({ ...SERIES_DEFAULT })}
                            className="text-[10px] font-medium text-primary hover:underline ml-1"
                        >
                            Show all
                        </button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg shrink-0 max-w-full justify-end">
                    {(['Day', 'Week', 'Month', '6M', '1Y', '3Y', 'All'] as TimePeriod[]).map((period) => (
                        <button
                            key={period}
                            type="button"
                            onClick={() => setTimePeriod(period)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                                timePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            {PERIOD_LABELS[period]}
                        </button>
                    ))}
                </div>
            </div>
            {snapshotSchemaMix.legacy > 0 && !legacySchemaBannerDismissed && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-3 py-2.5 text-xs text-amber-950 shadow-sm flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 leading-relaxed">
                        <span className="font-semibold">Historical mix:</span> {snapshotSchemaMix.legacy} saved point
                        {snapshotSchemaMix.legacy === 1 ? '' : 's'} use the <strong>legacy</strong> bucket layout (Sukuk was grouped under physical assets).
                        Each new <strong>Dashboard</strong> visit stores <strong>v{NW_BUCKETS_SCHEMA_V2}</strong> (Sukuk in Investments). Headline net worth stays consistent; only the <em>split</em> across bands changes.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            setLegacySchemaBannerDismissed(true);
                            try {
                                sessionStorage.setItem(LEGACY_SCHEMA_BANNER_KEY, '1');
                            } catch {
                                /* ignore */
                            }
                        }}
                        className="shrink-0 rounded-lg bg-white/80 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100/80"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            <ChartContainer height="100%" isEmpty={isEmpty} emptyMessage="No net worth history. Add accounts and transactions to see composition over time." className="flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{ ...CHART_MARGIN, right: 30, left: 20, bottom: showBrush ? 36 : CHART_MARGIN.bottom }}
                        stackOffset="sign"
                    >
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" fontSize={12} stroke={CHART_AXIS_COLOR} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} width={56} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip content={<NetWorthStackTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        <defs>
                            <linearGradient id="chartColorCash" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorInvestments" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorPhysical" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.tertiary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.tertiary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorReceivables" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={RECEIVABLES_COLOR} stopOpacity={0.75} />
                                <stop offset="95%" stopColor={RECEIVABLES_COLOR} stopOpacity={0.12} />
                            </linearGradient>
                            <linearGradient id="chartColorLiabilities" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.liability} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.liability} stopOpacity={0.1} />
                            </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="Cash" name="Cash" stackId="1" hide={!seriesVisible.Cash} stroke={CHART_COLORS.primary} fill="url(#chartColorCash)" />
                        <Area type="monotone" dataKey="Investments" name="Investments" stackId="1" hide={!seriesVisible.Investments} stroke={CHART_COLORS.secondary} fill="url(#chartColorInvestments)" />
                        <Area type="monotone" dataKey="Physical" name="Physical & commodities" stackId="1" hide={!seriesVisible.Physical} stroke={CHART_COLORS.tertiary} fill="url(#chartColorPhysical)" />
                        <Area type="monotone" dataKey="Receivables" name="Receivables" stackId="1" hide={!seriesVisible.Receivables} stroke={RECEIVABLES_COLOR} fill="url(#chartColorReceivables)" />
                        <Area type="monotone" dataKey="Liabilities" name="Debt" stackId="2" hide={!seriesVisible.Liabilities} stroke={CHART_COLORS.liability} fill="url(#chartColorLiabilities)" />
                        {showBrush ? (
                            <Brush dataKey="name" height={22} stroke="#94a3b8" travellerWidth={10} tickFormatter={() => ''} />
                        ) : null}
                    </AreaChart>
                </ResponsiveContainer>
            </ChartContainer>
            {liveBuckets && !isEmpty && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5">
                        <p className="text-slate-500 font-medium uppercase tracking-wide">Net worth</p>
                        <p className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(liveBuckets.netWorth, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-2 py-1.5">
                        <p className="text-sky-800/80 font-medium">Cash</p>
                        <p className="font-semibold text-sky-950 tabular-nums">{formatCurrencyString(liveBuckets.cash, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-2 py-1.5">
                        <p className="text-violet-900/80 font-medium">Investments</p>
                        <p className="font-semibold text-violet-950 tabular-nums">{formatCurrencyString(liveBuckets.investments, { digits: 0 })}</p>
                        <p className="text-[10px] text-violet-700/80 mt-0.5">Includes Sukuk (Assets)</p>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-2 py-1.5">
                        <p className="text-emerald-900/80 font-medium">Physical &amp; comm.</p>
                        <p className="font-semibold text-emerald-950 tabular-nums">{formatCurrencyString(liveBuckets.physicalAndCommodities, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-cyan-100 bg-cyan-50/60 px-2 py-1.5">
                        <p className="text-cyan-900/80 font-medium">Receivables</p>
                        <p className="font-semibold text-cyan-950 tabular-nums">{formatCurrencyString(liveBuckets.receivables, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-rose-100 bg-rose-50/60 px-2 py-1.5">
                        <p className="text-rose-900/80 font-medium">Debt</p>
                        <p className="font-semibold text-rose-950 tabular-nums">{formatCurrencyString(liveBuckets.liabilities, { digits: 0 })}</p>
                    </div>
                </div>
            )}
            {import.meta.env.DEV && liveReconcile && liveBuckets && (
                <details className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-2 py-1.5 text-[10px] text-slate-600">
                    <summary className="cursor-pointer font-semibold text-slate-700 select-none">
                        Developer · bucket reconciliation
                    </summary>
                    <div className="mt-1 font-mono space-y-0.5 text-[10px]">
                        <p>
                            Σ buckets vs net worth:{' '}
                            {liveReconcile.matches ? (
                                <span className="text-emerald-700">match (≤1.5 SAR)</span>
                            ) : (
                                <span className="text-rose-700">drift {liveReconcile.driftSar.toFixed(2)} SAR</span>
                            )}
                        </p>
                        <p className="text-slate-500">
                            sum={Math.round(liveReconcile.componentsSum)} · NW={Math.round(liveBuckets.netWorth)}
                        </p>
                    </div>
                </details>
            )}
        </div>
    );
};

export default NetWorthCompositionChart;
