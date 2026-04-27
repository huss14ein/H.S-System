import { useContext, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataContext } from '../../context/DataContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { resolveSarPerUsd, toSAR, tradableCashBucketToSAR } from '../../utils/currencyMath';
import { hydrateSarPerUsdDailySeries, getSarPerUsdForCalendarDay } from '../../services/fxDailySeries';
import { computePersonalNetWorthChartBucketsSAR } from '../../services/personalNetWorth';
import { listNetWorthSnapshots } from '../../services/netWorthSnapshot';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../../utils/wealthScope';
import type { Account, Transaction } from '../../types';
import InfoHint from '../InfoHint';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../../services/transactionFilters';
import { attributeNetWorthWithFlows } from '../../services/portfolioAttribution';

type TimePeriod = '1M' | '3M' | '6M' | '1Y' | 'All';

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  payload?: Array<{ payload?: { dayKey: string; netWorth: number } }>;
  label?: string;
  formatValue: (n: number) => string;
}) {
  const { active, payload, formatValue } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-slate-800">{shortLabel(row.dayKey) || row.dayKey}</p>
      <p className="mt-1 text-slate-600 tabular-nums">
        Net worth: <span className="font-semibold text-slate-900">{formatValue(row.netWorth)}</span>
      </p>
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

/** Calendar-day net cashflow (SAR), same KPI rules as the 30-day cockpit tile. */
function dailyNetCashflowSeriesSar(args: {
  transactions: Transaction[];
  accounts: Account[];
  data: unknown;
  uiExchangeRate: number;
  trailingDays: number;
}): Array<{ name: string; dayKey: string; net: number }> {
  const { transactions, accounts, data, uiExchangeRate } = args;
  const trailingDays = Math.min(31, Math.max(1, args.trailingDays));
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const curOf = (accountId: string): 'SAR' | 'USD' => (accById.get(accountId)?.currency === 'USD' ? 'USD' : 'SAR');
  const spot = resolveSarPerUsd(data as any, uiExchangeRate);

  const rows: Array<{ name: string; dayKey: string; net: number }> = [];
  const today = startOfLocalDay(new Date());

  for (let i = trailingDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayKey = toDayKeyLocal(d);
    let income = 0;
    let expenses = 0;
    for (const t of transactions) {
      const dk = String(t.date ?? '').slice(0, 10);
      if (dk !== dayKey) continue;
      const r = dk.length === 10 ? getSarPerUsdForCalendarDay(dk, data as any, uiExchangeRate) : spot;
      const amtSar = toSAR(Math.abs(Number(t.amount) || 0), curOf(t.accountId), r);
      if (countsAsIncomeForCashflowKpi(t)) income += amtSar;
      if (countsAsExpenseForCashflowKpi(t)) expenses += amtSar;
    }
    rows.push({ name: shortLabel(dayKey), dayKey, net: income - expenses });
  }
  return rows;
}

function netCashflowBetweenSarDated(args: {
  transactions: Transaction[];
  accounts: Account[];
  data: any;
  uiExchangeRate: number;
  startIso: string;
  endIso: string;
}): { income: number; expenses: number; net: number } {
  const { transactions, accounts, data, uiExchangeRate, startIso, endIso } = args;
  const t0 = new Date(startIso).getTime();
  const t1 = new Date(endIso).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return { income: 0, expenses: 0, net: 0 };
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const curOf = (accountId: string): 'SAR' | 'USD' => (accById.get(accountId)?.currency === 'USD' ? 'USD' : 'SAR');
  const spot = resolveSarPerUsd(data, uiExchangeRate);
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

export default function NetWorthCockpit(props: {
  title?: string;
  onOpenSummary?: () => void;
  onOpenInvestments?: () => void;
  onOpenAccounts?: () => void;
  onOpenAssets?: () => void;
}) {
  const { title = 'Net worth', onOpenSummary, onOpenInvestments, onOpenAccounts, onOpenAssets } = props;
  const { data, getAvailableCashForAccount } = useContext(DataContext)!;
  const { exchangeRate } = useCurrency();
  const { formatCurrencyString } = useFormatCurrency();
  const [period, setPeriod] = useState<TimePeriod>('6M');

  const computed = useMemo(() => {
    if (!data) {
      return {
        sarPerUsd: 3.75,
        live: null as null | ReturnType<typeof computePersonalNetWorthChartBucketsSAR>,
        series: [] as Array<{ dayKey: string; name: string; netWorth: number }>,
        nwYAxisDomain: undefined as [number, number] | undefined,
        accounts: [] as Account[],
        investCashBars: [] as Array<{ label: string; sar: number }>,
        net30d: { income: 0, expenses: 0, net: 0 },
        dailyNet14: [] as Array<{ name: string; dayKey: string; net: number }>,
        compositionStrip: [] as Array<{ key: string; label: string; sar: number; color: string }>,
        compositionTotal: 0,
        lastSnapshotAttribution: null as null | ReturnType<typeof attributeNetWorthWithFlows>,
        movers: [] as Array<{ symbol: string; name: string; valueSar: number; gainLossSar: number; gainLossPct: number }>,
      };
    }

    const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
    hydrateSarPerUsdDailySeries(data, exchangeRate, { horizonDays: 4000 });
    const todayKey = new Date().toISOString().slice(0, 10);
    const fxToday = getSarPerUsdForCalendarDay(todayKey, data, sarPerUsd);
    const live = computePersonalNetWorthChartBucketsSAR(data, fxToday, { getAvailableCashForAccount });

    const snaps = listNetWorthSnapshots();
    const cutoff = cutoffFor(period);
    const rawRows = snaps
      .map((s) => ({
        dayKey: toDayKeyLocal(new Date(s.at)),
        netWorth: safeNumber(s.netWorth),
      }))
      .filter((r) => (cutoff ? parseLocalDayKey(r.dayKey) >= cutoff : true));

    // Always include today (live) as the latest point.
    const todayLocalKey = toDayKeyLocal(new Date());
    const rows =
      rawRows.length && rawRows[0]?.dayKey === todayLocalKey
        ? rawRows.map((r) => (r.dayKey === todayLocalKey ? { ...r, netWorth: safeNumber(live.netWorth) } : r))
        : [{ dayKey: todayLocalKey, netWorth: safeNumber(live.netWorth) }, ...rawRows];

    const series = rows
      .slice()
      .reverse()
      .map((r) => ({ ...r, name: shortLabel(r.dayKey) }));

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
    const investmentAccounts = accounts.filter((a) => a.type === 'Investment');
    const investCashBars = investmentAccounts
      .map((acc) => {
        const cash = getAvailableCashForAccount?.(acc.id);
        const sar = tradableCashBucketToSAR({ SAR: cash?.SAR ?? 0, USD: cash?.USD ?? 0 }, sarPerUsd);
        return { label: (acc.name || 'Platform').slice(0, 14), sar: Math.max(0, sar) };
      })
      .filter((r) => r.sar > 0.5)
      .sort((a, b) => b.sar - a.sar)
      .slice(0, 8);

    const now = new Date();
    const start30d = new Date(now);
    start30d.setDate(start30d.getDate() - 30);
    const net30d = netCashflowBetweenSarDated({
      transactions,
      accounts,
      data,
      uiExchangeRate: sarPerUsd,
      startIso: start30d.toISOString(),
      endIso: now.toISOString(),
    });

    const dailyNet14 = dailyNetCashflowSeriesSar({
      transactions,
      accounts,
      data,
      uiExchangeRate: sarPerUsd,
      trailingDays: 14,
    });

    const compositionStrip = [
      { key: 'cash', label: 'Cash', sar: Math.max(0, live.cash), color: '#6366f1' },
      { key: 'inv', label: 'Investments', sar: Math.max(0, live.investments), color: '#10b981' },
      { key: 'phys', label: 'Physical', sar: Math.max(0, live.physicalAndCommodities), color: '#f59e0b' },
      { key: 'rec', label: 'Receivables', sar: Math.max(0, live.receivables), color: '#a855f7' },
    ].filter((x) => x.sar > 0.5);
    const compositionTotal = compositionStrip.reduce((s, x) => s + x.sar, 0);

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
              uiExchangeRate: sarPerUsd,
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
        const book: 'USD' | 'SAR' = (p.currency as any) === 'USD' ? 'USD' : 'SAR';
        return (p.holdings ?? []).map((h) => {
          const qty = Math.max(0, Number(h.quantity) || 0);
          const avg = Math.max(0, Number(h.avgCost) || 0);
          const curVal = Math.max(0, Number(h.currentValue) || 0);
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
      sarPerUsd,
      live,
      series,
      nwYAxisDomain,
      accounts,
      investCashBars,
      net30d,
      dailyNet14,
      compositionStrip,
      compositionTotal,
      lastSnapshotAttribution,
      movers,
    };
  }, [data, exchangeRate, getAvailableCashForAccount, period]);

  const live = computed.live;
  const isEmpty = !computed.series.length || !live;

  const assetsSar = live ? Math.max(0, live.cash) + Math.max(0, live.investments) + Math.max(0, live.physicalAndCommodities) + Math.max(0, live.receivables) : 0;
  const liabilitiesSar = live ? Math.max(0, live.liabilities) : 0;

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
                1 USD = {computed.sarPerUsd.toFixed(2)} SAR
              </span>
            </div>
            {live && (
              <p className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                {formatCurrencyString(live.netWorth, { digits: 0 })}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        {/* Left summary rail (like the reference UI) */}
        <aside className="lg:col-span-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Today snapshot</p>
          {live ? (
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
                <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(live.cash, { digits: 0 })}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Investments</span>
                <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(live.investments, { digits: 0 })}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Physical</span>
                <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(live.physicalAndCommodities, { digits: 0 })}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Receivables</span>
                <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(live.receivables, { digits: 0 })}</span>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Add accounts and assets to populate this view.</p>
          )}
          <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
            Tip: If something looks off, open <span className="font-semibold text-slate-700">System &amp; APIs Health</span> for reconciliation checks.
          </p>
        </aside>

        {/* Main chart + insight strip */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-3 min-h-[320px] flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Net worth trend</p>
              <p className="text-xs text-slate-600 mt-0.5">
                Uses daily snapshots (when you open the app) + today’s live books. Axis scales to your range so flat weeks still read clearly.
              </p>
            </div>
          </div>
          <div className="h-[240px] shrink-0">
            {isEmpty ? (
              <div className="h-full rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500">
                No history yet. Open Dashboard on different days to build the trend.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={computed.series} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.32} />
                      <stop offset="70%" stopColor="#4F46E5" stopOpacity={0.10} />
                      <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
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
                  <Area type="monotone" dataKey="netWorth" stroke="#4F46E5" strokeWidth={2} fill="url(#nwFill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {(computed.compositionTotal > 0 || computed.dailyNet14.length > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
              {computed.compositionTotal > 0 && (
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Asset mix (today)</p>
                  <p className="text-xs text-slate-600 mt-0.5 mb-2">Share of gross asset buckets (excludes liabilities).</p>
                  <div className="rounded-full bg-slate-100 h-3 overflow-hidden flex ring-1 ring-slate-200/80" title="Asset composition">
                    {computed.compositionStrip.map((seg) => (
                      <div
                        key={seg.key}
                        className="h-full min-w-[3px]"
                        style={{
                          width: `${computed.compositionTotal > 0 ? (seg.sar / computed.compositionTotal) * 100 : 0}%`,
                          backgroundColor: seg.color,
                        }}
                      />
                    ))}
                  </div>
                  <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                    {computed.compositionStrip.map((seg) => {
                      const pct = computed.compositionTotal > 0 ? (seg.sar / computed.compositionTotal) * 100 : 0;
                      return (
                        <li key={seg.key} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
                            <span className="truncate">{seg.label}</span>
                          </span>
                          <span className="tabular-nums text-slate-900 shrink-0">
                            {formatCurrencyString(seg.sar, { digits: 0 })}{' '}
                            <span className="text-slate-500">({pct.toFixed(0)}%)</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {computed.dailyNet14.length > 0 && (
                <div className="min-w-0 flex flex-col">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Daily cashflow pulse</p>
                  <p className="text-xs text-slate-600 mt-0.5 mb-1">Net per day (last 14 days), same rules as the cashflow tile.</p>
                  <div className="h-[128px] w-full flex-1 min-h-[128px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={computed.dailyNet14} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} fontSize={9} interval="preserveStartEnd" />
                        <YAxis
                          tickFormatter={(v) => formatAxisNumber(Number(v))}
                          tickLine={false}
                          axisLine={{ stroke: '#CBD5E1' }}
                          fontSize={9}
                          width={40}
                        />
                        <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 3" />
                        <Tooltip content={<DailyNetTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
                        <Bar dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={14}>
                          {computed.dailyNet14.map((e, i) => (
                            <Cell key={`dn-${e.dayKey}-${i}`} fill={e.net >= 0 ? '#059669' : '#e11d48'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Smart side widgets */}
        <section className="lg:col-span-3 grid grid-cols-1 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Investable cash</p>
            <p className="text-xs text-slate-600 mt-0.5">Cash sitting inside investment platforms (ready for trades).</p>
            <div className="h-[170px] mt-2">
              {computed.investCashBars.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={computed.investCashBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              If something looks wrong, open <span className="font-semibold text-slate-700">System &amp; APIs Health</span> for reconciliation checks.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

