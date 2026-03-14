import React, { useContext, useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { DataContext } from '../context/DataContext';
import { getMarketCalendarCached, getMarketCalendarFresh, type MarketCalendarLoadMode } from '../services/finnhubService';

type Impact = 'High' | 'Medium' | 'Low';
type EventCategory = 'Macro' | 'Earnings' | 'Dividend' | 'Portfolio';

interface MarketEventItem {
  id: string;
  date: Date;
  title: string;
  description: string;
  source: string;
  category: EventCategory;
  impact: Impact;
  symbol?: string;
  estimated?: boolean;
}

interface FinnhubCalendarState {
  mode: MarketCalendarLoadMode;
  events: MarketEventItem[];
  cachedAt?: number;
  warnings?: string[];
}

const IMPACT_STYLES: Record<Impact, string> = {
  High: 'bg-red-100 text-red-700 border-red-200',
  Medium: 'bg-amber-100 text-amber-700 border-amber-200',
  Low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const CATEGORY_STYLES: Record<EventCategory, string> = {
  Macro: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Earnings: 'bg-violet-50 text-violet-700 border-violet-200',
  Dividend: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  Portfolio: 'bg-slate-100 text-slate-700 border-slate-300',
};

const MONTHS_AHEAD = 6;
const REMINDER_KEY = 'market-events-reminders:v1';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): Date {
  const first = new Date(year, month0, 1);
  const delta = (weekday - first.getDay() + 7) % 7;
  const day = 1 + delta + (n - 1) * 7;
  return new Date(year, month0, day);
}

function lastWeekdayOfMonth(year: number, month0: number, weekday: number): Date {
  const last = new Date(year, month0 + 1, 0);
  const delta = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month0, last.getDate() - delta);
}

function firstWeekdayOfMonth(year: number, month0: number, weekday: number): Date {
  return nthWeekdayOfMonth(year, month0, weekday, 1);
}

function nextEstimatedEarningsDate(base: Date, symbol: string): Date {
  const quarterMonths = [0, 3, 6, 9];
  const nowYear = base.getFullYear();
  const offset = Array.from(symbol).reduce((s, c) => s + c.charCodeAt(0), 0) % 6;
  const day = 17 + offset;

  for (let y = nowYear; y <= nowYear + 1; y++) {
    for (const m of quarterMonths) {
      const candidate = new Date(y, m, day);
      if (candidate >= base) return candidate;
    }
  }
  return new Date(nowYear + 1, 0, day);
}

function nextEstimatedDividendDate(base: Date, symbol: string): Date {
  const offset = (Array.from(symbol).reduce((s, c) => s + c.charCodeAt(0), 0) % 12) + 1;
  const month = base.getMonth();
  const year = base.getFullYear();
  const candidate = new Date(year, month, Math.min(28, offset + 10));
  if (candidate >= base) return candidate;
  return new Date(year, month + 1, Math.min(28, offset + 10));
}

function addMacroEventsForMonth(year: number, month: number): MarketEventItem[] {
  const events: MarketEventItem[] = [
    {
      id: `nfp-${year}-${month}`,
      date: firstWeekdayOfMonth(year, month, 5),
      title: 'US Nonfarm Payrolls (NFP)',
      description: 'Labor market release often impacts rates, USD, and global equities.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'High',
      estimated: true,
    },
    {
      id: `cpi-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 3, 2),
      title: 'US CPI Inflation Release',
      description: 'Inflation surprise can shift rate expectations and sector leadership.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'High',
      estimated: true,
    },
    {
      id: `ppi-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 4, 2),
      title: 'US PPI Release',
      description: 'Producer prices can lead inflation expectations and bond-equity repricing.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `pmi-${year}-${month}`,
      date: firstWeekdayOfMonth(year, month, 1),
      title: 'Global PMI Wave',
      description: 'Manufacturing/services PMI trend is a fast risk-on / risk-off signal for equities.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `ecb-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 4, 2),
      title: 'ECB Rate Decision Window',
      description: 'European policy signals can spill into global rates and risk assets.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `boe-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 4, 1),
      title: 'BoE Policy Window',
      description: 'Bank of England decision can influence FX and multinational equity sentiment.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `boj-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 2, 3),
      title: 'BoJ Policy Window',
      description: 'Bank of Japan stance can affect global carry, yields, and cross-asset volatility.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `opec-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 3, 1),
      title: 'OPEC+ Meeting Window',
      description: 'Energy supply policy can move oil-sensitive equities and inflation expectations.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `usd-gdp-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 4, 4),
      title: 'US GDP Release Window',
      description: 'Growth surprise can drive broad market repricing and sector rotation.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'High',
      estimated: true,
    },
    {
      id: `opex-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 5, 3),
      title: 'Monthly Options Expiration (OpEx)',
      description: 'Expiration flows can create temporary volatility and price pinning effects.',
      source: 'Market structure (estimated schedule)',
      category: 'Macro',
      impact: 'Medium',
      estimated: true,
    },
    {
      id: `month-end-${year}-${month}`,
      date: lastWeekdayOfMonth(year, month, 5),
      title: 'Month-End Rebalancing Window',
      description: 'Institutional rebalancing can affect index-level flows and closing volatility.',
      source: 'Market structure (estimated schedule)',
      category: 'Macro',
      impact: 'Low',
      estimated: true,
    },
  ];

  if ([0, 2, 4, 6, 8, 10].includes(month % 12)) {
    events.push({
      id: `fomc-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 3, 3),
      title: 'Federal Reserve (FOMC) Decision',
      description: 'Policy statement and rate decision; major cross-asset volatility catalyst.',
      source: 'Macro (estimated schedule)',
      category: 'Macro',
      impact: 'High',
      estimated: true,
    });
  }

  if ([2, 5, 8, 11].includes(month % 12)) {
    events.push({
      id: `quad-witching-${year}-${month}`,
      date: nthWeekdayOfMonth(year, month, 5, 3),
      title: 'Quarterly Triple/Quad Witching Window',
      description: 'Quarterly derivatives expiry can increase short-term volume and volatility.',
      source: 'Market structure (estimated schedule)',
      category: 'Macro',
      impact: 'High',
      estimated: true,
    });
  }

  return events;
}

const MarketEvents: React.FC = () => {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const { data } = useContext(DataContext)!;
  const [categoryFilter, setCategoryFilter] = useState<'All' | EventCategory>('All');
  const [impactFilter, setImpactFilter] = useState<'All' | Impact>('All');
  const [finnhubState, setFinnhubState] = useState<FinnhubCalendarState>({ mode: 'none', events: [], warnings: [] });
  const [reminders, setReminders] = useState<Record<string, true>>({});
  const [includeEstimated, setIncludeEstimated] = useState(false);

  const trackedSymbols = useMemo(() => Array.from(new Set([
    ...(data?.watchlist ?? []).map(w => w.symbol?.trim().toUpperCase()).filter(Boolean),
    ...((data?.investments ?? []).flatMap(p => (p.holdings ?? []).map(h => h.symbol?.trim().toUpperCase())).filter(Boolean) as string[]),
  ])), [data]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMINDER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setReminders(parsed);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(REMINDER_KEY, JSON.stringify(reminders));
    } catch {
      // ignore
    }
  }, [reminders]);

  useEffect(() => {
    const now = startOfDay(new Date());
    const end = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, now.getDate());
    const from = now.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    let alive = true;

    getMarketCalendarCached(from, to, trackedSymbols).then((result) => {
      if (!alive) return;
      const macro = result.economic
        .filter((e) => e.date)
        .map((e, idx) => {
          const title = (e.event || '').trim() || 'Economic Calendar Event';
          const impact: Impact = /(rate|fomc|cpi|inflation|payroll|gdp|employment|pmi)/i.test(title) ? 'High' : 'Medium';
          return {
            id: `finnhub-econ-${e.date}-${idx}-${title}`,
            date: new Date(e.date),
            title,
            description: `${e.country || 'Global'} economic event${e.estimate ? ` • Estimate: ${e.estimate}` : ''}${e.actual ? ` • Actual: ${e.actual}` : ''}`,
            source: result.mode === 'fresh' ? 'Finnhub economic calendar' : 'Finnhub economic calendar (cached)',
            category: 'Macro' as const,
            impact,
            estimated: false,
          } satisfies MarketEventItem;
        });

      const earnings = result.earnings
        .filter((e) => e.date)
        .map((e) => ({
          id: `finnhub-earnings-${e.symbol}-${e.date}`,
          date: new Date(e.date!),
          title: `${e.symbol} earnings (Finnhub)`,
          description: `Quarter ${e.quarter} ${e.year}${e.revenueEstimate != null ? ` • Revenue est: ${e.revenueEstimate}` : ''}`,
          source: result.mode === 'fresh' ? 'Finnhub earnings calendar' : 'Finnhub earnings calendar (cached)',
          category: 'Earnings' as const,
          impact: 'High' as const,
          symbol: e.symbol,
          estimated: false,
        }));

      setFinnhubState({ mode: result.mode, cachedAt: result.cachedAt, warnings: result.warnings || [], events: [...macro, ...earnings].filter((e) => Number.isFinite(e.date.getTime())) });

      if (result.mode === 'cache_fresh') {
        getMarketCalendarFresh(from, to, trackedSymbols).then((freshResult) => {
          if (!alive) return;
          const freshMacro = freshResult.economic
            .filter((e) => e.date)
            .map((e, idx) => ({
              id: `finnhub-econ-fresh-${e.date}-${idx}-${e.event}`,
              date: new Date(e.date),
              title: (e.event || '').trim() || 'Economic Calendar Event',
              description: `${e.country || 'Global'} economic event${e.estimate ? ` • Estimate: ${e.estimate}` : ''}${e.actual ? ` • Actual: ${e.actual}` : ''}`,
              source: 'Finnhub economic calendar',
              category: 'Macro' as const,
              impact: /(rate|fomc|cpi|inflation|payroll|gdp|employment|pmi)/i.test(e.event || '') ? 'High' as const : 'Medium' as const,
              estimated: false,
            }));
          const freshEarnings = freshResult.earnings
            .filter((e) => e.date)
            .map((e) => ({
              id: `finnhub-earnings-fresh-${e.symbol}-${e.date}`,
              date: new Date(e.date!),
              title: `${e.symbol} earnings (Finnhub)`,
              description: `Quarter ${e.quarter} ${e.year}${e.revenueEstimate != null ? ` • Revenue est: ${e.revenueEstimate}` : ''}`,
              source: 'Finnhub earnings calendar',
              category: 'Earnings' as const,
              impact: 'High' as const,
              symbol: e.symbol,
              estimated: false,
            }));
          setFinnhubState({
            mode: 'fresh',
            cachedAt: freshResult.cachedAt,
            warnings: freshResult.warnings || [],
            events: [...freshMacro, ...freshEarnings].filter((e) => Number.isFinite(e.date.getTime())),
          });
        }).catch(() => {});
      }
    }).catch(() => {
      if (!alive) return;
      setFinnhubState({ mode: 'none', events: [], warnings: ['Live Finnhub calendar is unavailable right now. You can enable modeled estimates from the filter bar if needed.'] });
    });

    return () => { alive = false; };
  }, [trackedSymbols]);

  const events = useMemo(() => {
    const now = startOfDay(new Date());
    const end = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, now.getDate());

    const modeledMacro: MarketEventItem[] = [];
    for (let i = 0; i < MONTHS_AHEAD; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      modeledMacro.push(...addMacroEventsForMonth(d.getFullYear(), d.getMonth()));
    }

    const modeledSymbolEvents: MarketEventItem[] = trackedSymbols.flatMap((symbol) => {
      const earningsDate = nextEstimatedEarningsDate(now, symbol);
      const divDate = nextEstimatedDividendDate(now, symbol);
      const agmDate = new Date(earningsDate.getFullYear(), earningsDate.getMonth(), Math.max(1, earningsDate.getDate() - 10));
      return [
        {
          id: `earnings-${symbol}`,
          date: earningsDate,
          title: `${symbol} earnings window`,
          description: 'Estimated earnings period; verify exact date with your broker/exchange calendar.',
          source: 'Symbol model (estimated)',
          category: 'Earnings' as const,
          impact: 'High' as const,
          symbol,
          estimated: true,
        },
        {
          id: `guidance-${symbol}`,
          date: new Date(earningsDate.getFullYear(), earningsDate.getMonth(), Math.min(28, earningsDate.getDate() + 1)),
          title: `${symbol} guidance / call reaction window`,
          description: 'Post-earnings guidance and call commentary can move valuation and momentum.',
          source: 'Symbol model (estimated)',
          category: 'Earnings' as const,
          impact: 'Medium' as const,
          symbol,
          estimated: true,
        },
        {
          id: `dividend-${symbol}`,
          date: divDate,
          title: `${symbol} dividend / ex-date window`,
          description: 'Estimated distribution / ex-date window; verify exact corporate action dates.',
          source: 'Symbol model (estimated)',
          category: 'Dividend' as const,
          impact: 'Low' as const,
          symbol,
          estimated: true,
        },
        {
          id: `agm-${symbol}`,
          date: agmDate,
          title: `${symbol} shareholder meeting window`,
          description: 'Board / shareholder resolutions can impact policy, payouts, and market expectations.',
          source: 'Symbol model (estimated)',
          category: 'Portfolio' as const,
          impact: 'Low' as const,
          symbol,
          estimated: true,
        },
      ];
    });

    const firstBuyBySymbol = new Map<string, Date>();
    (data?.investmentTransactions ?? [])
      .filter(t => t.type === 'buy' && t.symbol)
      .forEach((t) => {
        const s = t.symbol.trim().toUpperCase();
        const d = new Date(t.date);
        const prev = firstBuyBySymbol.get(s);
        if (!prev || d < prev) firstBuyBySymbol.set(s, d);
      });

    const portfolioEvents: MarketEventItem[] = Array.from(firstBuyBySymbol.entries()).flatMap(([symbol, firstBuy]) => {
      const nextMonthReview = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const quarterlyReview = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      return [
        {
          id: `review-next-${symbol}`,
          date: nextMonthReview,
          title: `${symbol} monthly position review checkpoint`,
          description: `Position first opened on ${firstBuy.toLocaleDateString()}; review thesis, allocation drift, and risk before next month starts.`,
          source: 'Portfolio timeline',
          category: 'Portfolio',
          impact: 'Medium',
          symbol,
        },
        {
          id: `review-quarter-${symbol}`,
          date: quarterlyReview,
          title: `${symbol} quarterly rebalance window`,
          description: 'Quarterly checkpoint for allocation sizing, concentration risk, and thesis updates.',
          source: 'Portfolio timeline',
          category: 'Portfolio',
          impact: 'Medium',
          symbol,
        },
      ];
    });

    const reliableEvents = [...finnhubState.events, ...portfolioEvents];
    const modeledEvents = [...modeledMacro, ...modeledSymbolEvents];

    return [...reliableEvents, ...(includeEstimated ? modeledEvents : [])]
      .filter((e) => e.date >= now && e.date <= end)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [data, trackedSymbols, finnhubState.events, includeEstimated]);

  const filtered = useMemo(() => events.filter((e) =>
    (categoryFilter === 'All' || e.category === categoryFilter) &&
    (impactFilter === 'All' || e.impact === impactFilter)
  ), [events, categoryFilter, impactFilter]);

  const stats = useMemo(() => {
    const macroCount = filtered.filter((e) => e.category === 'Macro').length;
    const symbolCount = filtered.filter((e) => Boolean(e.symbol)).length;
    const highImpact = filtered.filter((e) => e.impact === 'High').length;
    return { macroCount, symbolCount, highImpact };
  }, [filtered]);

  const toggleReminder = (eventId: string) => {
    setReminders((prev) => {
      const next = { ...prev };
      if (next[eventId]) delete next[eventId];
      else next[eventId] = true;
      return next;
    });
  };

  const downloadIcs = () => {
    const rows = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finova//Market Events//EN'];
    filtered.slice(0, 500).forEach((event) => {
      const d = event.date;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      rows.push('BEGIN:VEVENT');
      rows.push(`UID:${event.id}@finova`);
      rows.push(`DTSTAMP:${yyyy}${mm}${dd}T000000Z`);
      rows.push(`DTSTART;VALUE=DATE:${yyyy}${mm}${dd}`);
      rows.push(`SUMMARY:${event.title.replace(/[,;\n]/g, ' ')}`);
      rows.push(`DESCRIPTION:${(event.description + ' Source: ' + event.source).replace(/[,;\n]/g, ' ')}`);
      rows.push('END:VEVENT');
    });
    rows.push('END:VCALENDAR');
    const blob = new Blob([rows.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'market-events.ics';
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <PageLayout
      title="Market Events"
      description="Important upcoming dates for markets, your watchlist, and your investment holdings."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 border border-slate-200 rounded-md bg-white">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs rounded-l-md ${
                viewMode === 'list' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 text-xs rounded-r-md ${
                viewMode === 'calendar' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Calendar
            </button>
          </div>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeEstimated}
              onChange={(e) => setIncludeEstimated(e.target.checked)}
            />
            Include modeled estimates
          </label>
          <select className="select-base text-sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as 'All' | EventCategory)}>
            <option value="All">All categories</option>
            <option value="Macro">Macro</option>
            <option value="Earnings">Earnings</option>
            <option value="Dividend">Dividend</option>
            <option value="Portfolio">Portfolio</option>
          </select>
          <select className="select-base text-sm" value={impactFilter} onChange={(e) => setImpactFilter(e.target.value as 'All' | Impact)}>
            <option value="All">All impact levels</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The calendar shows provider-backed events (Finnhub economic + earnings) and your portfolio timeline by default. You can optionally enable modeled estimates for broader planning windows.
          The calendar includes broad market-impacting dates (rates, inflation, labor, policy, derivatives expiry, and rebalancing windows) plus symbol-linked windows from your watchlist and holdings. Some dates are model-based estimates to reduce manual entry.
          <div className="mt-1 text-xs text-amber-700">
            Finnhub events are cached locally for 12 hours to avoid requesting the same calendar data every page load and still work in offline mode.
            {finnhubState.mode === 'fresh' && ' Source mode: fresh fetch.'}
            {finnhubState.mode === 'cache_fresh' && ' Source mode: cached snapshot (within 12h).'}
            {finnhubState.mode === 'cache_stale' && ` Source mode: offline fallback from stale cache${finnhubState.cachedAt ? ` (${new Date(finnhubState.cachedAt).toLocaleString()})` : ''}.`}
            {finnhubState.mode === 'none' && ' Source mode: no cached snapshot yet.'}
            {!includeEstimated && ' Modeled estimates are currently hidden for higher accuracy.'}
            {includeEstimated && ' Modeled estimates are enabled (marked as Estimated in event cards).'}
          </div>
          {Array.isArray(finnhubState.warnings) && finnhubState.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-800 space-y-1">
              {finnhubState.warnings.map((w, idx) => <li key={`finnhub-warn-${idx}`}>{w}</li>)}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-outline text-xs" onClick={downloadIcs}>Export filtered calendar (.ics)</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">High impact events</p><p className="font-semibold text-slate-800">{highImpactLabel(stats.highImpact)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Macro events</p><p className="font-semibold text-slate-800">{stats.macroCount}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Symbol-linked events</p><p className="font-semibold text-slate-800">{stats.symbolCount}</p></div>
        </div>

        {viewMode === 'list' ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {filtered.map((event) => (
              <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-800">{event.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${IMPACT_STYLES[event.impact]}`}>{event.impact}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full border ${CATEGORY_STYLES[event.category]}`}>{event.category}</span>
                  <span className="text-slate-500">{event.date.toLocaleDateString()}</span>
                  {event.symbol && <span className="text-slate-700 font-medium">• {event.symbol}</span>}
                  {event.estimated && <span className="text-amber-700">• Estimated</span>}
                  {reminders[event.id] && <span className="text-emerald-700">• Reminder on</span>}
                </div>
                <p className="mt-2 text-sm text-slate-600">{event.description}</p>
                <p className="mt-1 text-xs text-slate-500">Source: {event.source}</p>
                <div className="mt-2">
                  <button type="button" onClick={() => toggleReminder(event.id)} className={`text-xs px-2 py-1 rounded border ${reminders[event.id] ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                    {reminders[event.id] ? 'Disable reminder' : 'Enable reminder'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <CalendarView 
            events={filtered}
            month={calendarMonth}
            year={calendarYear}
            onMonthChange={(month, year) => { setCalendarMonth(month); setCalendarYear(year); }}
            onEventClick={(_event) => {
              // Could open a modal or scroll to event
            }}
            reminders={reminders}
            onToggleReminder={toggleReminder}
          />
        )}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">
            No events found for current filters.
          </div>
        )}
      </div>
    </PageLayout>
  );
};

function highImpactLabel(v: number): string {
  return v > 0 ? String(v) : '0';
}

// Calendar View Component
const CalendarView: React.FC<{
  events: MarketEventItem[];
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
  onEventClick: (event: MarketEventItem) => void;
  reminders: Record<string, boolean>;
  onToggleReminder: (eventId: string) => void;
}> = ({ events, month, year, onMonthChange, onEventClick, reminders, onToggleReminder }) => {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  
  // Group events by date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, MarketEventItem[]>();
    events.forEach(event => {
      const dateKey = `${event.date.getFullYear()}-${String(event.date.getMonth() + 1).padStart(2, '0')}-${String(event.date.getDate()).padStart(2, '0')}`;
      if (event.date.getMonth() === month && event.date.getFullYear() === year) {
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(event);
      }
    });
    return map;
  }, [events, month, year]);
  
  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (month === 0) {
        onMonthChange(11, year - 1);
      } else {
        onMonthChange(month - 1, year);
      }
    } else {
      if (month === 11) {
        onMonthChange(0, year + 1);
      } else {
        onMonthChange(month + 1, year);
      }
    }
  };
  
  const today = new Date();
  const isToday = (day: number) => 
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Calendar Header */}
      <div className="bg-gradient-to-r from-primary to-primary/80 p-4 text-white">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateMonth('prev')}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            aria-label="Previous month"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-xl font-bold">
            {monthNames[month]} {year}
          </h2>
          <button
            type="button"
            onClick={() => navigateMonth('next')}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            aria-label="Next month"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            onMonthChange(now.getMonth(), now.getFullYear());
          }}
          className="mt-2 text-sm text-white/90 hover:text-white underline"
        >
          Go to Today
        </button>
      </div>
      
      {/* Calendar Grid */}
      <div className="p-4">
        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map(day => (
            <div key={day} className="text-center text-xs font-semibold text-slate-600 py-2">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-1">
          {/* Empty cells for days before month starts */}
          {Array.from({ length: startingDayOfWeek }).map((_, idx) => (
            <div key={`empty-${idx}`} className="aspect-square" />
          ))}
          
          {/* Days of the month */}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEvents = eventsByDate.get(dateKey) || [];
            const todayClass = isToday(day) ? 'ring-2 ring-primary bg-primary/5' : '';
            
            return (
              <div
                key={day}
                className={`aspect-square border border-slate-200 rounded-lg p-1 overflow-y-auto hover:bg-slate-50 transition-colors ${todayClass}`}
              >
                <div className={`text-xs font-semibold mb-1 ${isToday(day) ? 'text-primary' : 'text-slate-700'}`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map(event => (
                    <div
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      className={`text-[10px] px-1 py-0.5 rounded cursor-pointer truncate ${
                        event.impact === 'High' ? 'bg-red-100 text-red-700 border border-red-200' :
                        event.impact === 'Medium' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                        'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      }`}
                      title={`${event.title} - ${event.category}`}
                    >
                      {event.title.length > 15 ? event.title.substring(0, 15) + '...' : event.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-slate-500 px-1">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Event Details Modal/Expansion */}
      <div className="border-t border-slate-200 p-4 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Events This Month</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {events.filter(e => e.date.getMonth() === month && e.date.getFullYear() === year).map(event => (
            <div
              key={event.id}
              className="bg-white rounded-lg p-2 border border-slate-200 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-slate-800">{event.title}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${IMPACT_STYLES[event.impact]}`}>
                      {event.impact}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${CATEGORY_STYLES[event.category]}`}>
                      {event.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{event.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                  {event.symbol && <p className="text-xs text-slate-500 mt-0.5">Symbol: {event.symbol}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onToggleReminder(event.id)}
                  className={`text-xs px-2 py-1 rounded border flex-shrink-0 ${
                    reminders[event.id] 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {reminders[event.id] ? '✓' : '○'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MarketEvents;
