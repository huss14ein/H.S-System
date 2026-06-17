import { useContext, useMemo, useState, memo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataContext } from '../../context/DataContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { useCanonicalFinancialMetrics } from '../../hooks/useCanonicalFinancialMetrics';
import { useLiveQuotePrices } from '../../hooks/useLiveQuotePrices';
import type { DashboardCanonicalMetrics } from '../../services/canonicalFinancialMetrics';
import type { SimulatedPriceMap } from '../../services/investmentPlatformCardMetrics';
import { toSAR } from '../../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency } from '../../utils/holdingValuation';
import { resolveInvestmentPortfolioCurrency } from '../../utils/investmentPortfolioCurrency';
import { getSarPerUsdForCalendarDay } from '../../services/fxDailySeries';
import { useHydrateSarPerUsdDailySeries } from '../../hooks/useHydrateSarPerUsdDailySeries';
import { listNetWorthSnapshots } from '../../services/netWorthSnapshot';
import { buildNetWorthTrendSeriesFromSnapshots } from '../../services/netWorthChartDense';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../../utils/wealthScope';
import type { Account, Transaction } from '../../types';
import InfoHint from '../InfoHint';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../../services/transactionFilters';
import { attributeNetWorthWithFlows } from '../../services/portfolioAttribution';

type TimePeriod = '1M' | '3M' | '6M' | '1Y' | 'All';

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-based week start (local), for consistent weekly cashflow buckets. */
function mondayOfWeekContaining(d: Date): Date {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function parseLocalDayKey(dayKey: string): Date {
  const [y, m, d] = (dayKey || '').split('-').map((x) => Number(x));
  if (!(y > 1900) || !(m >= 1) || !(d >= 1)) return new Date(0);
  return new Date(y, m - 1, d);
}

function toDayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shortLabel(dayKey: string): string {
  const t = parseLocalDayKey(dayKey);
  if (!Number.isFinite(t.getTime()) || t.getTime() <= 0) return '';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cutoffFor(period: TimePeriod): Date | null {
  const now = startOfLocalDay(new Date());
  if (period === 'All') return null;
  const days = period === '1M' ? 31 : period === '3M' ? 93 : period === '6M' ? 186 : 365;
  const c = new Date(now);
  c.setDate(c.getDate() - days);
  return c;
}

function safeNumber(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function formatAxisNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

function AreaTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload?: { dayKey: string; netWorth: number; deltaFromPrev?: number } }>;
  label?: string;
  formatValue: (n: number) => string;
}) {
  const { active, payload, formatValue } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const d = typeof row.deltaFromPrev === 'number' && Number.isFinite(row.deltaFromPrev) ? row.deltaFromPrev : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-slate-800">{shortLabel(row.dayKey) || row.dayKey}</p>
      <p className="mt-1 text-slate-600 tabular-nums">
        Net worth: <span className="font-semibold text-slate-900">{formatValue(row.netWorth)}</span>
      </p>
      {d != null && d !== 0 && (
        <p className={`mt-1 tabular-nums font-medium ${d >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          vs prior point: {d >= 0 ? '+' : ''}
          {formatValue(d)}
        </p>
      )}
    </div>
  );
}

function CashTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload?: { label: string; sar: number } }>;
  formatValue: (n: number) => string;
}) {
  const { active, payload, formatValue } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-slate-800">{row.label}</p>
      <p className="mt-1 text-slate-600 tabular-nums">
        Investable cash: <span className="font-semibold text-slate-900">{formatValue(row.sar)}</span>
      </p>
    </div>
  );
}

function DailyNetTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload?: { name: string; dayKey: string; net: number } }>;
  formatValue: (n: number) => string;
}) {
  const { active, payload, formatValue } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-slate-800">{shortLabel(row.dayKey) || row.dayKey}</p>
      <p className={`mt-1 tabular-nums ${row.net >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
        Net cashflow: <span className="font-semibold">{formatValue(row.net)}</span>
      </p>
      <p className="mt-0.5 text-[10px] text-slate-500 leading-snug">Income − spending (excl. internal transfers).</p>
    </div>
  );
}

function netCashflowBetweenSarDated(args: {
  transactions: Transaction[];
  accounts: Account[];
  data: any;
  /** Headline spot FX (`useCanonicalFinancialMetrics().sarPerUsd`) for undated fallback lines. */
  spotSarPerUsd: number;
  uiExchangeRate: number;
  startIso: string;
  endIso: string;
}): { income: number; expenses: number; net: number } {
  const { transactions, accounts, data, spotSarPerUsd, uiExchangeRate, startIso, endIso } = args;
  const t0 = new Date(startIso).getTime();
  const t1 = new Date(endIso).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return { income: 0, expenses: 0, net: 0 };
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const curOf = (accountId: string): 'SAR' | 'USD' => (accById.get(accountId)?.currency === 'USD' ? 'USD' : 'SAR');
  const spot = spotSarPerUsd;
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    const ts = new Date(t.date).getTime();
    if (ts < t0 || ts > t1) continue;
    const day = String(t.date ?? '').slice(0, 10);
    const r = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : spot;
    const amtSar = toSAR(Math.abs(Number(t.amount) || 0), curOf(t.accountId), r);
    if (countsAsIncomeForCashflowKpi(t)) income += amtSar;
    if (countsAsExpenseForCashflowKpi(t)) expenses += amtSar;
  }
  return { income, expenses, net: income - expenses };
}

export type NetWorthCockpitMetricsOverride = Pick<
  DashboardCanonicalMetrics,
  'headline' | 'todaySnapshot' | 'investableCashBars' | 'sarPerUsd'
> & { simulatedPrices?: SimulatedPriceMap };

type NetWorthCockpitShellProps = {
  title?: string;
  onOpenSummary?: () => void;
  onOpenInvestments?: () => void;
  onOpenAccounts?: () => void;
  onOpenAssets?: () => void;
  onOpenDataReconciliation?: () => void;
};

function NetWorthCockpitContent(
  props: NetWorthCockpitShellProps & {
    metrics: NetWorthCockpitMetricsOverride & { simulatedPrices: SimulatedPriceMap };
  },
) {
  const {
    title = 'Net worth',
    onOpenSummary,
    onOpenInvestments,
    onOpenAccounts,
    onOpenAssets,
    onOpenDataReconciliation,
    metrics,
  } = props;
  const { headline, todaySnapshot, investableCashBars, sarPerUsd } = metrics;
  const simulatedPrices = useLiveQuotePrices();
  const { data } = useContext(DataContext)!;
  const { exchangeRate } = useCurrency();
  useHydrateSarPerUsdDailySeries(data, exchangeRate);
  const { formatCurrencyString } = useFormatCurrency();
  const [period, setPeriod] = useState<TimePeriod>('6M');
  const buckets = headline.buckets;

  const computed = useMemo(() => {
    if (!data) {
      return {
        series: [] as Array<{ dayKey: string; name: string; netWorth: number; deltaFromPrev: number }>,
        nwYAxisDomain: undefined as [number, number] | undefined,
        nwTrendInChart: null as null | {
          fromDayKey: string;
          toDayKey: string;
          deltaSar: number;
          deltaPct: number;
          points: number;
        },
        accounts: [] as Account[],
        net30d: { income: 0, expenses: 0, net: 0 },
        weeklyNet8: [] as Array<{ name: string; net: number; weekStartKey: string; dayKey: string }>,
        compositionPieData: [] as Array<{ name: string; value: number; fill: string }>,
        compositionStrip: [] as Array<{ key: string; label: string; sar: number; color: string }>,
        compositionTotal: 0,
        lastSnapshotAttribution: null as null | ReturnType<typeof attributeNetWorthWithFlows>,
        movers: [] as Array<{ symbol: string; name: string; valueSar: number; gainLossSar: number; gainLossPct: number }>,
      };
    }

    const snaps = listNetWorthSnapshots();
    const cutoff = cutoffFor(period);
    const todayLocalKey = toDayKeyLocal(new Date());
    const liveNw = safeNumber(buckets.netWorth);

    let seedBeforeRange: number | null = null;
    if (cutoff) {
      for (const s of snaps) {
        const dayKey = toDayKeyLocal(new Date(s.at));
        if (parseLocalDayKey(dayKey) >= cutoff) continue;
        const nw = safeNumber(s.netWorth);
        if (nw > 0.5) {
          seedBeforeRange = nw;
          break;
        }
      }
    }

    const sparseByDay = new Map<string, number>();
    for (const s of snaps) {
      const dayKey = toDayKeyLocal(new Date(s.at));
      if (sparseByDay.has(dayKey)) continue;
      if (cutoff && parseLocalDayKey(dayKey) < cutoff) continue;
      sparseByDay.set(dayKey, safeNumber(s.netWorth));
    }
    sparseByDay.set(todayLocalKey, liveNw);

    const sparseRows = Array.from(sparseByDay.entries()).map(([dayKey, netWorth]) => ({ dayKey, netWorth }));

    const seriesChrono = buildNetWorthTrendSeriesFromSnapshots(sparseRows, shortLabel, seedBeforeRange);
    const series = seriesChrono.map((r, i) => ({
      ...r,
      deltaFromPrev: i > 0 ? r.netWorth - seriesChrono[i - 1]!.netWorth : 0,
    }));

    let nwTrendInChart: {
      fromDayKey: string;
      toDayKey: string;
      deltaSar: number;
      deltaPct: number;
      points: number;
    } | null = null;
    if (series.length >= 1) {
      const first = series[0];
      const last = series[series.length - 1];
      const deltaSar = last.netWorth - first.netWorth;
      const denom = Math.abs(first.netWorth);
      const deltaPct = denom > 1e-6 ? (deltaSar / denom) * 100 : 0;
      nwTrendInChart = {
        fromDayKey: first.dayKey,
        toDayKey: last.dayKey,
        deltaSar,
        deltaPct,
        points: series.length,
      };
    }

    const nwVals = series.map((s) => s.netWorth).filter((n) => Number.isFinite(n));
    let nwYAxisDomain: [number, number] | undefined;
    if (nwVals.length >= 1) {
      const mn = Math.min(...nwVals);
      const mx = Math.max(...nwVals);
      const span = Math.max(mx - mn, Math.abs(mx) * 0.0025, 1);
      const pad = span * 0.15;
      nwYAxisDomain = [mn - pad, mx + pad];
    }

    const accounts = getPersonalAccounts(data) as Account[];
    const transactions = getPersonalTransactions(data) as Transaction[];
    const portfolios = getPersonalInvestments(data);

    const now = new Date();
    const start30d = new Date(now);
    start30d.setDate(start30d.getDate() - 30);
    const net30d = netCashflowBetweenSarDated({
      transactions,
      accounts,
      data,
      spotSarPerUsd: sarPerUsd,
      uiExchangeRate: exchangeRate,
      startIso: start30d.toISOString(),
      endIso: now.toISOString(),
    });

    const weeklyNet8: Array<{ name: string; net: number; weekStartKey: string; dayKey: string }> = [];
    const anchorMonday = mondayOfWeekContaining(now);
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(anchorMonday);
      weekStart.setDate(weekStart.getDate() - i * 7);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const { net } = netCashflowBetweenSarDated({
        transactions,
        accounts,
        data,
        spotSarPerUsd: sarPerUsd,
        uiExchangeRate: exchangeRate,
        startIso: weekStart.toISOString(),
        endIso: weekEnd.toISOString(),
      });
      const mk = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      const dk = toDayKeyLocal(weekStart);
      weeklyNet8.push({ name: mk, net, weekStartKey: dk, dayKey: dk });
    }

    const compositionStrip = [
      { key: 'cash', label: 'Cash', sar: Math.max(0, buckets.cash), color: '#6366f1' },
      { key: 'inv', label: 'Investments', sar: Math.max(0, buckets.investments), color: '#10b981' },
      { key: 'phys', label: 'Physical', sar: Math.max(0, buckets.physicalAndCommodities), color: '#f59e0b' },
      { key: 'rec', label: 'Receivables', sar: Math.max(0, buckets.receivables), color: '#a855f7' },
    ].filter((x) => x.sar > 0.5);
    const compositionTotal = compositionStrip.reduce((s, x) => s + x.sar, 0);
    const compositionPieData = compositionStrip.map((s) => ({
      name: s.label,
      value: s.sar,
      fill: s.color,
    }));

    const snapsFull = listNetWorthSnapshots();
    const lastSnapshotAttribution =
      snapsFull.length >= 2
        ? (() => {
            const older = snapsFull[1];
            const newer = snapsFull[0];
            const flow = netCashflowBetweenSarDated({
              transactions,
              accounts,
              data,
              spotSarPerUsd: sarPerUsd,
              uiExchangeRate: exchangeRate,
              startIso: older.at,
              endIso: newer.at,
            }).net;
            return attributeNetWorthWithFlows({
              startNw: safeNumber(older.netWorth),
              endNw: safeNumber(newer.netWorth),
              externalCashflow: flow,
            });
          })()
        : null;

    const movers = portfolios
      .flatMap((p) => {
        const book = resolveInvestmentPortfolioCurrency(p);
        return (p.holdings ?? []).map((h) => {
          const qty = Math.max(0, Number(h.quantity) || 0);
          const avg = Math.max(0, Number(h.avgCost) || 0);
          const curVal = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
          const cost = avg * qty;
          const gainLoss = curVal - cost;
          const gainLossPct = cost > 0 ? (gainLoss / cost) * 100 : 0;
          const valueSar = toSAR(curVal, book, sarPerUsd);
          const gainLossSar = toSAR(gainLoss, book, sarPerUsd);
          const sym = String(h.symbol ?? '').toUpperCase();
          const nm = String((h.name ?? sym) || 'Holding');
          return { symbol: sym || nm, name: nm, valueSar, gainLossSar, gainLossPct };
        });
      })
      .filter((m) => m.symbol && Number.isFinite(m.valueSar) && m.valueSar > 1)
      .sort((a, b) => Math.abs(b.gainLossSar) - Math.abs(a.gainLossSar))
      .slice(0, 6);

    return {
      series,
      nwYAxisDomain,
      nwTrendInChart,
      accounts,
      net30d,
      weeklyNet8,
      compositionStrip,
      compositionPieData,
      compositionTotal,
      lastSnapshotAttribution,
      movers,
    };
  }, [data, buckets, sarPerUsd, exchangeRate, period, simulatedPrices]);

  const isEmpty = !computed.series.length || !data;
  const assetsSar = todaySnapshot.assetsSar;
  const liabilitiesSar = todaySnapshot.totalDebtSar;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
              <InfoHint
                placement="bottom"
                text="A cockpit view: net worth over time + what it’s made of today. Everything is calculated in SAR for consistency; USD holdings convert using your FX reference rate."
              />
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 tabular-nums">
                1 USD = {sarPerUsd.toFixed(2)} SAR
              </span>
            </div>
            {buckets && (
              <p className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                {formatCurrencyString(buckets.netWorth, { digits: 0 })}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {onOpenSummary && (
                <button
                  type="button"
                  onClick={onOpenSummary}
                  className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Full summary →
                </button>
              )}
              {onOpenInvestments && (
                <button
                  type="button"
                  onClick={onOpenInvestments}
                  className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Open investments
                </button>
              )}
              {onOpenAccounts && (
                <button
                  type="button"
                  onClick={onOpenAccounts}
                  className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Accounts
                </button>
              )}
              {onOpenAssets && (
                <button
                  type="button"
                  onClick={onOpenAssets}
                  className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Assets
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
            {(['1M', '3M', '6M', '1Y', 'All'] as TimePeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 lg:items-stretch gap-4 p-4 min-w-0">
        {/* Left: today snapshot + allocation & weekly rhythm (uses vertical space under snapshot) */}
        <aside className="lg:col-span-4 flex h-full min-h-0 min-w-0 flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 shrink-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Today snapshot</p>
            {buckets ? (
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Assets</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(assetsSar, { digits: 0 })}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Liabilities</span>
                  <span className="font-semibold text-rose-800 tabular-nums">−{formatCurrencyString(liabilitiesSar, { digits: 0 })}</span>
                </li>
                <li className="h-px bg-slate-200 my-1" />
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Cash</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(todaySnapshot.cashSar, { digits: 0 })}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600" title="Platforms, commodities, and Sukuk — same total as the Investments hub headline.">Investments</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(todaySnapshot.investmentsSar, { digits: 0 })}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600" title="Illiquid physical assets (property, vehicles, etc.). Commodities are included under Investments above.">Physical assets</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(todaySnapshot.physicalAndCommoditiesSar, { digits: 0 })}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Receivables</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(todaySnapshot.receivablesSar, { digits: 0 })}</span>
                </li>
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Add accounts and assets to populate this view.</p>
            )}
            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
              Tip: If something looks off,{' '}
              {onOpenDataReconciliation ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={onOpenDataReconciliation}>
                  open System &amp; APIs Health — Data reconciliation
                </button>
              ) : (
                <span className="font-semibold text-slate-700">System &amp; APIs Health → Data reconciliation</span>
              )}
              .
            </p>
          </div>

          {buckets && (
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 min-h-0 lg:min-h-[280px]">
              <div className="shrink-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Allocation &amp; weekly rhythm</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Wealth mix and net savings by week — stacked here so the trend chart can use the full center column.
                </p>
              </div>
              <div className="flex flex-1 flex-col gap-4 min-h-0">
                <div className="flex min-h-[200px] flex-1 min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3 sm:p-4">
                  <div className="mb-2 shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Wealth composition</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Gross assets by role — excludes liabilities.
                    </p>
                  </div>
                  {computed.compositionTotal > 0 ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                      <div className="relative mx-auto h-[180px] w-full max-w-[min(100%,260px)] shrink-0 sm:h-[200px] sm:mx-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={computed.compositionPieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={52}
                              outerRadius={78}
                              paddingAngle={2}
                            >
                              {computed.compositionPieData.map((entry) => (
                                <Cell key={`cell-${entry.name}`} fill={entry.fill} stroke="#fff" strokeWidth={2} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatCurrencyString(value, { digits: 0 })} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-2">
                          <div className="text-center px-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gross assets</p>
                            <p className="text-base sm:text-lg font-extrabold text-slate-900 tabular-nums leading-tight">
                              {formatCurrencyString(computed.compositionTotal, { digits: 0 })}
                            </p>
                          </div>
                        </div>
                      </div>
                      <ul className="flex-1 min-w-0 w-full space-y-2 text-[12px] overflow-x-hidden">
                        {computed.compositionStrip.map((seg) => {
                          const pct = computed.compositionTotal > 0 ? (seg.sar / computed.compositionTotal) * 100 : 0;
                          return (
                            <li
                              key={seg.key}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="h-3 w-3 rounded-md shrink-0 shadow-sm" style={{ backgroundColor: seg.color }} />
                                <span className="font-medium text-slate-800 truncate">{seg.label}</span>
                              </span>
                              <span className="tabular-nums text-right shrink-0 text-[11px] sm:text-xs">
                                <span className="font-semibold text-slate-900">{formatCurrencyString(seg.sar, { digits: 0 })}</span>
                                <span className="text-slate-500 ml-2">{pct.toFixed(0)}%</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 min-h-[100px]">
                      Link accounts and assets to see how wealth is allocated.
                    </div>
                  )}
                </div>

                <div className="flex min-h-[180px] flex-1 min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3 sm:p-4 z-0 isolate">
                  <div className="mb-2 shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Weekly savings rhythm</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Net per week (Mon–Sun) — income minus spending, same rules as your Summary cards.
                    </p>
                  </div>
                  <div className="min-h-[160px] w-full min-w-0 flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={computed.weeklyNet8} margin={{ top: 10, right: 8, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} fontSize={10} interval={0} />
                        <YAxis
                          tickFormatter={(v) => formatAxisNumber(Number(v))}
                          tickLine={false}
                          axisLine={{ stroke: '#CBD5E1' }}
                          fontSize={10}
                          width={44}
                        />
                        <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 3" />
                        <Tooltip content={<DailyNetTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
                        <Bar dataKey="net" radius={[6, 6, 0, 0]} maxBarSize={36}>
                          {computed.weeklyNet8.map((e, i) => (
                            <Cell key={`wk-${e.weekStartKey}-${i}`} fill={e.net >= 0 ? '#059669' : '#e11d48'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Center: net worth trend — summary strip + chart */}
        <section className="lg:col-span-5 flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/40 p-3 shadow-sm">
          <div className="mb-2 shrink-0 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Net worth trend</p>
                  <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">{period}</span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-snug max-w-prose">
                  One point per calendar day you opened the app (stored history), ending with <strong>today’s live</strong> headline net worth. Hover a point for level and day-over-day step.
                </p>
              </div>
            </div>
            {!isEmpty && computed.nwTrendInChart && computed.nwTrendInChart.points >= 2 && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50 via-white to-violet-50/50 px-3 py-2.5 shadow-sm">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-900/80 shrink-0">In this window</span>
                <span className="text-xs text-slate-600 tabular-nums shrink-0">
                  {shortLabel(computed.nwTrendInChart.fromDayKey)} → {shortLabel(computed.nwTrendInChart.toDayKey)}
                </span>
                <span
                  className={`text-sm font-extrabold tabular-nums shrink-0 ${computed.nwTrendInChart.deltaSar >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                  title="Change from first to last point on the chart (not investment return)"
                >
                  {computed.nwTrendInChart.deltaSar >= 0 ? '+' : ''}
                  {formatCurrencyString(computed.nwTrendInChart.deltaSar, { digits: 0 })}
                </span>
                <span
                  className={`text-xs font-bold tabular-nums ${computed.nwTrendInChart.deltaPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                  title="Percent change from first point’s net worth to last"
                >
                  ({computed.nwTrendInChart.deltaPct >= 0 ? '+' : ''}
                  {computed.nwTrendInChart.deltaPct.toFixed(1)}%)
                </span>
                <span className="text-[11px] text-slate-500 ml-auto tabular-nums">{computed.nwTrendInChart.points} days</span>
              </div>
            )}
            {!isEmpty && computed.nwTrendInChart && computed.nwTrendInChart.points < 2 && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-snug">
                Only one snapshot in this range — visit on another day (or widen to <strong>All</strong>) to see movement across time.
              </p>
            )}
          </div>
          <div className="min-h-[260px] flex-1 min-w-0 w-full lg:min-h-[320px]">
            {isEmpty ? (
              <div className="h-full min-h-[240px] rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500">
                No history yet. Open Dashboard on different days to build the trend.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={computed.series} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.32} />
                      <stop offset="70%" stopColor="#4F46E5" stopOpacity={0.10} />
                      <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} fontSize={11} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis
                    domain={computed.nwYAxisDomain}
                    allowDataOverflow
                    tickFormatter={(v) => formatAxisNumber(Number(v))}
                    tickLine={false}
                    axisLine={{ stroke: '#CBD5E1' }}
                    fontSize={11}
                    width={54}
                  />
                  <Tooltip content={<AreaTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
                  <Area
                    type="monotone"
                    dataKey="netWorth"
                    stroke="#4338ca"
                    strokeWidth={2.5}
                    fill="url(#nwFill)"
                    activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2, fill: '#312e81' }}
                    dot={(dotProps: { cx?: number; cy?: number; index?: number }) => {
                      const { cx, cy, index } = dotProps;
                      const last = computed.series.length - 1;
                      if (cx == null || cy == null || index !== last || last < 1) {
                        return <g key={`nw-skip-${index ?? 0}`} />;
                      }
                      return (
                        <circle
                          key="nw-latest-dot"
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill="#312e81"
                          stroke="#fff"
                          strokeWidth={2}
                          className="drop-shadow-sm"
                        />
                      );
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Smart side widgets */}
        <section className="lg:col-span-3 grid h-full min-h-0 min-w-0 grid-cols-1 content-start gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Investable cash</p>
            <p className="text-xs text-slate-600 mt-0.5">Cash sitting inside investment platforms (ready for trades).</p>
            <div className="h-[170px] mt-2">
              {investableCashBars.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={investableCashBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} fontSize={10} interval={0} angle={-20} height={40} />
                    <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} fontSize={10} width={42} />
                    <Tooltip content={<CashTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
                    <Bar dataKey="sar" fill="#10B981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500">
                  No investable cash recorded yet.
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
              If cash here is missing, record deposits/withdrawals in Investments or sync broker cash balances.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Market movers</p>
              {onOpenInvestments && (
                <button
                  type="button"
                  onClick={onOpenInvestments}
                  className="text-[11px] font-semibold text-indigo-700 hover:underline"
                >
                  Open →
                </button>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-0.5">Top positions by gain/loss vs cost (approx; based on holding cost basis).</p>
            {computed.movers.length ? (
              <ul className="mt-2 space-y-2">
                {computed.movers.map((m) => (
                  <li key={`mv-${m.symbol}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/40 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{m.name}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Value: {formatCurrencyString(m.valueSar, { digits: 0 })}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-xs font-bold tabular-nums ${m.gainLossSar >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {m.gainLossSar >= 0 ? '+' : ''}
                        {formatCurrencyString(m.gainLossSar, { digits: 0 })}
                      </p>
                      <p className={`text-[11px] font-semibold tabular-nums ${m.gainLossPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {m.gainLossPct >= 0 ? '+' : ''}
                        {m.gainLossPct.toFixed(1)}%
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                No holdings yet.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Cashflow (last 30 days)</p>
            <p className="text-xs text-slate-600 mt-0.5">Income minus spending (excludes internal transfers). Converted to SAR with dated FX.</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900/80">Income</p>
                <p className="mt-1 font-semibold tabular-nums text-emerald-950">{formatCurrencyString(computed.net30d.income, { digits: 0 })}</p>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-900/80">Spending</p>
                <p className="mt-1 font-semibold tabular-nums text-rose-950">{formatCurrencyString(computed.net30d.expenses, { digits: 0 })}</p>
              </div>
              <div
                className={`rounded-xl border p-2 ${
                  computed.net30d.net >= 0 ? 'border-sky-100 bg-sky-50/60' : 'border-amber-100 bg-amber-50/60'
                }`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Net</p>
                <p className={`mt-1 font-semibold tabular-nums ${computed.net30d.net >= 0 ? 'text-sky-900' : 'text-amber-900'}`}>
                  {computed.net30d.net >= 0 ? '+' : ''}
                  {formatCurrencyString(computed.net30d.net, { digits: 0 })}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-indigo-50/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">What changed since last snapshot</p>
              <InfoHint placement="bottom" text="Uses the last two saved net worth snapshots (from visiting Dashboard). Splits the change into external cashflow vs residual (market marks, FX, new debt/assets, etc.)." />
            </div>
            {computed.lastSnapshotAttribution ? (
              <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
                {computed.lastSnapshotAttribution.bullets.map((b, i) => (
                  <li key={`attr-${i}`} className="flex gap-2">
                    <span className="text-slate-300">•</span>
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Not enough history yet. Open <span className="font-semibold text-slate-800">Dashboard</span> on two different days to create snapshots.
              </p>
            )}
            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
              If something looks wrong,{' '}
              {onOpenDataReconciliation ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={onOpenDataReconciliation}>
                  open System &amp; APIs Health — Data reconciliation
                </button>
              ) : (
                <span className="font-semibold text-slate-700">System &amp; APIs Health → Data reconciliation</span>
              )}
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

const MemoNetWorthCockpitContent = memo(NetWorthCockpitContent);

function NetWorthCockpitFromCanonical(shell: NetWorthCockpitShellProps) {
  const { headline, todaySnapshot, investableCashBars, sarPerUsd, simulatedPrices } = useCanonicalFinancialMetrics();
  return (
    <MemoNetWorthCockpitContent
      {...shell}
      metrics={{ headline, todaySnapshot, investableCashBars, sarPerUsd, simulatedPrices }}
    />
  );
}

export default function NetWorthCockpit(
  props: NetWorthCockpitShellProps & { metricsOverride?: NetWorthCockpitMetricsOverride },
) {
  const { metricsOverride, ...shell } = props;
  if (metricsOverride) {
    return (
      <MemoNetWorthCockpitContent
        {...shell}
        metrics={{
          ...metricsOverride,
          simulatedPrices: metricsOverride.simulatedPrices ?? {},
        }}
      />
    );
  }
  return <NetWorthCockpitFromCanonical {...shell} />;
}
