import React, { useContext, useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { DataContext } from '../context/DataContext';
import { getMarketCalendarCached } from '../services/finnhubService';

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
  fromCache: boolean;
  events: MarketEventItem[];
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
  const { data } = useContext(DataContext)!;
  const [categoryFilter, setCategoryFilter] = useState<'All' | EventCategory>('All');
  const [impactFilter, setImpactFilter] = useState<'All' | Impact>('All');
  const [finnhubState, setFinnhubState] = useState<FinnhubCalendarState>({ fromCache: false, events: [] });

  const trackedSymbols = useMemo(() => Array.from(new Set([
    ...(data?.watchlist ?? []).map(w => w.symbol?.trim().toUpperCase()).filter(Boolean),
    ...((data?.investments ?? []).flatMap(p => (p.holdings ?? []).map(h => h.symbol?.trim().toUpperCase())).filter(Boolean) as string[]),
  ])), [data]);

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
            source: result.fromCache ? 'Finnhub economic calendar (cached)' : 'Finnhub economic calendar',
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
          source: result.fromCache ? 'Finnhub earnings calendar (cached)' : 'Finnhub earnings calendar',
          category: 'Earnings' as const,
          impact: 'High' as const,
          symbol: e.symbol,
          estimated: false,
        }));

      setFinnhubState({ fromCache: result.fromCache, events: [...macro, ...earnings].filter((e) => Number.isFinite(e.date.getTime())) });
    }).catch(() => {
      if (!alive) return;
      setFinnhubState({ fromCache: false, events: [] });
    });

    return () => { alive = false; };
  }, [trackedSymbols]);

  const events = useMemo(() => {
    const now = startOfDay(new Date());
    const end = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, now.getDate());

    const macro: MarketEventItem[] = [];
    for (let i = 0; i < MONTHS_AHEAD; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      macro.push(...addMacroEventsForMonth(d.getFullYear(), d.getMonth()));
    }

    const symbolEvents: MarketEventItem[] = trackedSymbols.flatMap((symbol) => {
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

    return [...finnhubState.events, ...macro, ...symbolEvents, ...portfolioEvents]
      .filter((e) => e.date >= now && e.date <= end)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [data, trackedSymbols, finnhubState.events]);

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

  return (
    <PageLayout
      title="Market Events"
      description="Important upcoming dates for markets, your watchlist, and your investment holdings."
      action={
        <div className="flex flex-wrap items-center gap-2">
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
          The calendar includes broad market-impacting dates (rates, inflation, labor, policy, derivatives expiry, and rebalancing windows) plus symbol-linked windows from your watchlist and holdings. Some dates are model-based estimates to reduce manual entry.
          <div className="mt-1 text-xs text-amber-700">
            Finnhub events are cached locally for 12 hours to avoid requesting the same calendar data every page load.
            {finnhubState.events.length > 0 ? ` Source mode: ${finnhubState.fromCache ? 'cached snapshot' : 'fresh fetch'}.` : ''}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">High impact events</p><p className="font-semibold text-slate-800">{highImpactLabel(stats.highImpact)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Macro events</p><p className="font-semibold text-slate-800">{stats.macroCount}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Symbol-linked events</p><p className="font-semibold text-slate-800">{stats.symbolCount}</p></div>
        </div>

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
              </div>
              <p className="mt-2 text-sm text-slate-600">{event.description}</p>
              <p className="mt-1 text-xs text-slate-500">Source: {event.source}</p>
            </div>
          ))}
        </div>

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

export default MarketEvents;
