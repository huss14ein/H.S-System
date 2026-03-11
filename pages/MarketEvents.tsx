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
  const { data } = useContext(DataContext)!;
  const [categoryFilter, setCategoryFilter] = useState<'All' | EventCategory>('All');
  const [impactFilter, setImpactFilter] = useState<'All' | Impact>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [remindersOnly, setRemindersOnly] = useState(false);
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

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return events.filter((e) => {
      if (categoryFilter !== 'All' && e.category !== categoryFilter) return false;
      if (impactFilter !== 'All' && e.impact !== impactFilter) return false;
      if (remindersOnly && !reminders[e.id]) return false;
      if (!query) return true;
      const haystack = `${e.title} ${e.description} ${e.symbol || ''} ${e.source}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [events, categoryFilter, impactFilter, searchQuery, remindersOnly, reminders]);

  const stats = useMemo(() => {
    const macroCount = filtered.filter((e) => e.category === 'Macro').length;
    const symbolCount = filtered.filter((e) => Boolean(e.symbol)).length;
    const highImpact = filtered.filter((e) => e.impact === 'High').length;
    const reminderCount = filtered.filter((e) => reminders[e.id]).length;
    const today = startOfDay(new Date()).getTime();
    const next7 = filtered.filter((e) => {
      const days = Math.floor((startOfDay(e.date).getTime() - today) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 7;
    }).length;
    return { macroCount, symbolCount, highImpact, reminderCount, next7 };
  }, [filtered, reminders]);

  const topFocusEvents = useMemo(() => {
    const scoreImpact: Record<Impact, number> = { High: 3, Medium: 2, Low: 1 };
    return [...filtered]
      .map((event) => {
        const daysUntil = Math.max(0, Math.floor((startOfDay(event.date).getTime() - startOfDay(new Date()).getTime()) / (1000 * 60 * 60 * 24)));
        const urgency = daysUntil <= 1 ? 3 : daysUntil <= 7 ? 2 : 1;
        const personalized = event.symbol ? 1 : 0;
        const reminderBoost = reminders[event.id] ? 1 : 0;
        const score = scoreImpact[event.impact] * 2 + urgency + personalized + reminderBoost;
        return { event, score, daysUntil };
      })
      .sort((a, b) => b.score - a.score || a.daysUntil - b.daysUntil)
      .slice(0, 5);
  }, [filtered, reminders]);


  const groupedByMonth = useMemo(() => {
    const map = new Map<string, MarketEventItem[]>();
    filtered.forEach((event) => {
      const key = `${event.date.getFullYear()}-${String(event.date.getMonth() + 1).padStart(2, '0')}`;
      map.set(key, [...(map.get(key) || []), event]);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        key,
        label: new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        items,
      }));
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
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search symbol, event, source"
            className="input-base h-9 w-56 text-sm"
          />
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeEstimated}
              onChange={(e) => setIncludeEstimated(e.target.checked)}
            />
            Include modeled estimates
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={remindersOnly}
              onChange={(e) => setRemindersOnly(e.target.checked)}
            />
            Reminders only
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
      <div className="space-y-4">
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-sky-50 to-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Smart market command center</p>
          <p className="mt-1 text-sm text-slate-700">Priority-ranked market intelligence aligned with your portfolio, watchlist, and macro risk windows.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatCard label="High impact" value={highImpactLabel(stats.highImpact)} />
            <StatCard label="Next 7 days" value={String(stats.next7)} />
            <StatCard label="Macro" value={String(stats.macroCount)} />
            <StatCard label="Symbol-linked" value={String(stats.symbolCount)} />
            <StatCard label="Reminders" value={String(stats.reminderCount)} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">AI-style focus queue</h3>
          <p className="mt-1 text-xs text-slate-500">Sorted by impact, timing urgency, and portfolio relevance.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {topFocusEvents.length === 0 && <p className="text-sm text-slate-500">No focus events for current filters.</p>}
            {topFocusEvents.map(({ event, score, daysUntil }) => (
              <div key={`focus-${event.id}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{event.title}</p>
                  <span className="text-xs text-indigo-700 font-semibold">Priority {score}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{daysUntil === 0 ? 'Today' : `In ${daysUntil} day${daysUntil === 1 ? '' : 's'}`} • {event.date.toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>

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

        <div className="space-y-4">
          {groupedByMonth.map((group) => (
            <div key={group.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">{group.label}</h3>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {group.items.map((event) => (
                  <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-semibold text-slate-800">{event.title}</h4>
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-800">{value}</p>
    </div>
  );
}

export default MarketEvents;
