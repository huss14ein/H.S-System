import React, { useState, useCallback, useContext, useMemo, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Page } from '../types';
import { probeGeminiProxyHealth, type SystemHealthAiContext } from '../services/geminiService';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { useCurrency } from '../context/CurrencyContext';
import { getPersonalAccounts, getPersonalCommodityHoldings, getPersonalInvestments, getPersonalTransactions, getPersonalWealthData } from '../utils/wealthScope';
import AIAdvisor from '../components/AIAdvisor';
import { getMarketStatus, getMarketHolidays, finnhubFetch, resolveQuotePrice, type MarketStatusItem, type MarketHoliday } from '../services/finnhubService';
import { DataContext } from '../context/DataContext';
import { computePersonalInvestmentKpiBreakdown, type InvestmentCapitalSource } from '../services/investmentKpiCore';
import {
  computePersonalCommoditiesContributionSAR,
  computePersonalPlatformsRollupSAR,
  type SimulatedPriceMap,
} from '../services/investmentPlatformCardMetrics';
import { toSAR, tradableCashBucketToSARSigned } from '../utils/currencyMath';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { CloudIcon } from '../components/icons/CloudIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { reconcileCashAccountBalance, reconcileCreditAccountBalance } from '../services/dataQuality';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { reconcileHoldings, reconciliationExceptionReport } from '../services/reconciliationEngine';
import DashboardKpiQualityPanel from '../components/DashboardKpiQualityPanel';
import {
  validateSystemIntegrity,
  detectBrokenReferences,
  repairSuggestionEngine,
  pushException,
  clearExceptionQueue,
  getExceptionQueue,
} from '../services/exceptionHandlingEngine';
import type { InvestmentTransaction, Holding, Transaction, Account, Goal } from '../types';

type ServiceStatus = 'Operational' | 'Degraded Performance' | 'Outage' | 'Checking...' | 'Simulated';

interface Service {
  name: string;
  status: ServiceStatus;
  responseTime?: number;
  error?: string;
}

interface HealthIncident {
  at: string;
  service: string;
  status: ServiceStatus;
  message?: string;
}

const AUTO_REFRESH_SECONDS = 90;
const INCIDENTS_KEY = 'system-health-incidents:v1';

const initialServices: Service[] = [
  { name: 'Authentication Service (Supabase)', status: 'Operational' },
  { name: 'Database Service (Supabase)', status: 'Operational' },
  { name: 'AI Services API (Gemini)', status: 'Operational' },
  { name: 'Market Data API (Finnhub)', status: 'Operational' },
  { name: 'Users table (Supabase)', status: 'Operational' },
];

const getStatusInfo = (status: ServiceStatus) => {
  switch (status) {
    case 'Operational': return { color: 'bg-green-500', icon: <CheckCircleIcon className="h-5 w-5 text-green-600" />, text: 'text-green-700' };
    case 'Degraded Performance': return { color: 'bg-yellow-500', icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />, text: 'text-yellow-700' };
    case 'Outage': return { color: 'bg-red-500', icon: <XCircleIcon className="h-5 w-5 text-red-600" />, text: 'text-red-700' };
    case 'Simulated': return { color: 'bg-blue-500', icon: <CloudIcon className="h-5 w-5 text-blue-600" />, text: 'text-blue-700' };
    default: return { color: 'bg-gray-400 animate-pulse', icon: <div className="h-5 w-5"><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-500"></div></div>, text: 'text-gray-500' };
  }
};

const statusWeight: Record<ServiceStatus, number> = {
  Operational: 100,
  'Degraded Performance': 70,
  Outage: 25,
  'Checking...': 50,
  Simulated: 85,
};

type InvestmentKpiReconciliation = {
  /** Stocks + broker cash only (same as `computePersonalInvestmentKpiBreakdown`; excludes commodities & Sukuk). */
  totalValueSar: number;
  holdingsValueSar: number;
  brokerageCashSar: number;
  /** Signed SAR equivalent of broker buckets (may be negative if the ledger is inconsistent). */
  brokerageCashRawSar: number;
  netCapitalSar: number;
  totalGainLossSar: number;
  roi: number;
  capitalSource: InvestmentCapitalSource;
  depositsSar: number;
  withdrawalsSar: number;
  buysSar: number;
  sellsSar: number;
  dividendsSar: number;
  feesSar: number;
  vatSar: number;
  inferredInvestedFromLedgerSar: number;
  holdingsCostBasisSar: number;
  fallbackInvestedSar: number;
  expectedCashFromLedgerSar: number;
  cashLedgerDriftSar: number;
  /** Mirrors Investments page headline cards: platforms + commodities + Sukuk. */
  investmentsHeadline: {
    totalValueSar: number;
    platformsRollupSar: number;
    commoditiesValueSar: number;
    sukukValueSar: number;
    commodityCostSar: number;
    sukukCostSar: number;
    combinedNetCapitalSar: number;
    combinedGainLossSar: number;
  };
  notes: string[];
};

const SystemHealth: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage: _setActivePage }) => {
  const [services, setServices] = useState<Service[]>(initialServices);
  const [isLoading, setIsLoading] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatusItem | null>(null);
  const [marketHolidays, setMarketHolidays] = useState<MarketHoliday[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
  const [incidents, setIncidents] = useState<HealthIncident[]>([]);
  const appDataCtx = useContext(DataContext);
  const { exchangeRate } = useCurrency();

  const runHealthChecks = useCallback(async (_trigger: 'manual' | 'auto' = 'manual') => {
    setIsLoading(true);
    setServices((prev) =>
      prev.map((s) =>
        s.status !== 'Simulated' ? { ...s, status: 'Checking...', responseTime: undefined, error: undefined } : s
      )
    );

    const checkSupabaseAuth = async (): Promise<Partial<Service>> => {
      if (!supabase) return { status: 'Outage', error: 'Supabase client is not configured.' };
      try {
        const start = performance.now();
        const { error } = await supabase.auth.getSession();
        if (error) throw error;
        const duration = Math.round(performance.now() - start);
        return { status: duration > 1500 ? 'Degraded Performance' : 'Operational', responseTime: duration };
      } catch {
        return { status: 'Outage', error: 'Could not connect to Supabase Auth.' };
      }
    };

    const checkSupabaseDB = async (): Promise<Partial<Service>> => {
      if (!supabase) return { status: 'Outage', error: 'Supabase client is not configured.' };
      try {
        const start = performance.now();
        const { error } = await supabase.from('accounts').select('id', { count: 'exact', head: true });
        if (error) throw error;
        const duration = Math.round(performance.now() - start);
        return { status: duration > 1500 ? 'Degraded Performance' : 'Operational', responseTime: duration };
      } catch {
        return { status: 'Outage', error: 'Could not connect to Supabase Database.' };
      }
    };

    const checkAIService = async (): Promise<Partial<Service>> => {
      try {
        const r = await probeGeminiProxyHealth();
        if (!r.ok) {
          return { status: 'Outage', responseTime: r.ms, error: r.error ?? 'AI proxy unhealthy.' };
        }
        return {
          status: r.ms > 3500 ? 'Degraded Performance' : 'Operational',
          responseTime: r.ms,
          error: undefined,
        };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'AI health probe failed.';
        return { status: 'Outage', error: errorMessage };
      }
    };

    const checkFinnhubService = async (): Promise<Partial<Service>> => {
      const finnhubApiKey = import.meta.env.VITE_FINNHUB_API_KEY;
      if (!finnhubApiKey) return { status: 'Outage', error: 'Finnhub API key missing. Set VITE_FINNHUB_API_KEY.' };
      try {
        const start = performance.now();
        const response = await finnhubFetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(finnhubApiKey)}`);
        if (response.status === 429) throw new Error('Rate limit exceeded (60/min). Try again in a minute.');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const quote = await response.json();
        const price = resolveQuotePrice(quote ?? {});
        if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid Finnhub quote payload.');
        const duration = Math.round(performance.now() - start);
        return { status: duration > 2000 ? 'Degraded Performance' : 'Operational', responseTime: duration };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not connect to Finnhub Market Data API.';
        return { status: 'Outage', error: msg };
      }
    };

    const checkMultiUserAccess = async (): Promise<Partial<Service>> => {
      if (!supabase) return { status: 'Outage', error: 'Supabase client is not configured.' };
      try {
        const start = performance.now();
        const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true });
        if (error) throw error;
        const duration = Math.round(performance.now() - start);
        const n = Number(count ?? 0);
        if (n <= 0) {
          return {
            status: 'Degraded Performance',
            responseTime: duration,
            error: 'No rows in `users` table (unexpected for a signed-in app).',
          };
        }
        return {
          status: duration > 1500 ? 'Degraded Performance' : 'Operational',
          responseTime: duration,
          error: undefined,
        };
      } catch {
        return { status: 'Outage', error: 'Could not read `users` table (RLS or schema).' };
      }
    };

    const [auth, db, ai, finnhub, multiUser] = await Promise.all([
      checkSupabaseAuth(),
      checkSupabaseDB(),
      checkAIService(),
      checkFinnhubService(),
      checkMultiUserAccess(),
    ]);

    const nowIso = new Date().toISOString();
    let mergedRows: Service[] = [];
    setServices((prev) => {
      mergedRows = prev.map((s) => {
        if (s.status === 'Simulated') return s;
        if (s.name.includes('Authentication')) return { ...s, ...auth } as Service;
        if (s.name.includes('Database')) return { ...s, ...db } as Service;
        if (s.name.includes('AI Services')) return { ...s, ...ai } as Service;
        if (s.name.includes('Market Data API (Finnhub)')) return { ...s, ...finnhub } as Service;
        if (s.name.includes('Users table')) return { ...s, ...multiUser } as Service;
        return s;
      });
      return mergedRows;
    });
    setLastCheckedAt(nowIso);
    setNextRefreshIn(AUTO_REFRESH_SECONDS);

    const newIncidents = mergedRows
      .filter((s) => s.status === 'Outage' || s.status === 'Degraded Performance')
      .map((s) => ({ at: nowIso, service: s.name, status: s.status, message: s.error } as HealthIncident));
    if (newIncidents.length > 0) {
      setIncidents((prev) => {
        const merged = [...newIncidents, ...prev].slice(0, 30);
        try { localStorage.setItem(INCIDENTS_KEY, JSON.stringify(merged)); } catch {}
        return merged;
      });
    }

    if (finnhub.status === 'Operational' && import.meta.env.VITE_FINNHUB_API_KEY) {
      Promise.all([getMarketStatus('US').catch(() => null), getMarketHolidays('US').catch(() => [])]).then(([status, holidays]) => {
        setMarketStatus(status || null);
        setMarketHolidays(Array.isArray(holidays) ? holidays.slice(0, 5) : []);
      });
    } else {
      setMarketStatus(null);
      setMarketHolidays([]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INCIDENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setIncidents(parsed.slice(0, 30));
      }
    } catch {}
  }, []);

  useEffect(() => {
    runHealthChecks('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNextRefreshIn((prev) => {
        if (prev <= 1) {
          runHealthChecks('auto');
          return AUTO_REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runHealthChecks]);

  const overallStatus = useMemo((): ServiceStatus => {
    if (services.some((s) => s.status === 'Outage')) return 'Outage';
    if (services.some((s) => s.status === 'Degraded Performance')) return 'Degraded Performance';
    if (services.some((s) => s.status === 'Checking...')) return 'Checking...';
    return 'Operational';
  }, [services]);

  const healthScore = useMemo(() => {
    const valid = services.filter((s) => s.status !== 'Checking...');
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((sum, s) => sum + statusWeight[s.status], 0) / valid.length);
  }, [services]);

  const smartInsights = useMemo(() => {
    const degraded = services.filter((s) => s.status === 'Degraded Performance').length;
    const outages = services.filter((s) => s.status === 'Outage').length;
    const withRt = services.filter((s) => Number.isFinite(s.responseTime));
    const avgLatency =
      withRt.length === 0 ? 0 : Math.round(withRt.reduce((sum, s) => sum + (s.responseTime ?? 0), 0) / withRt.length);
    const topIncident = incidents[0];

    const recommendations: string[] = [];
    if (outages > 0) recommendations.push('Resolve active outages first (credentials, deployment, or API quota).');
    if (degraded > 0) recommendations.push('Degraded services detected: tune retries/timeouts and check upstream response ceilings.');
    if (avgLatency > 1800) recommendations.push('Average probe latency is high; check network path to your proxy/API region.');
    if (!recommendations.length) recommendations.push('All key services are healthy. Keep auto-check cadence active for early anomaly detection.');

    return { degraded, outages, avgLatency, topIncident, recommendations: recommendations.slice(0, 3) };
  }, [services, incidents]);

  const integritySummary = useMemo(() => {
    const financialData = appDataCtx?.data;
    if (!financialData) return null;

    const accounts = getPersonalAccounts(financialData) as Account[];
    const transactions = getPersonalTransactions(financialData) as Transaction[];
    const goals = (financialData.goals ?? []) as Goal[];
    const rate = resolveSarPerUsd(financialData, exchangeRate);
    const personalAccountIds = new Set(accounts.map((a) => a.id));

    const integrity = validateSystemIntegrity({
      accounts: accounts.map((a) => ({ id: a.id, balance: a.balance })),
      transactions: transactions.map((t) => ({ accountId: t.accountId })),
      goals: goals.map((g) => ({ id: g.id })),
    });

    const brokenRefs = detectBrokenReferences({
      goals: goals.map((g) => ({ id: g.id })),
      accounts: accounts.map((a) => ({ id: a.id })),
      transactions: transactions.map((t) => ({ accountId: t.accountId, goalId: (t as any).goalId })),
    });

    const cashExceptions = accounts
      .filter((a) => a.type === 'Checking' || a.type === 'Savings')
      .map((a) => {
        const r = reconcileCashAccountBalance(a as Account, transactions);
        if (r == null || !r.showWarning) return null;
        const bookCurrency: 'USD' | 'SAR' = a.currency === 'USD' ? 'USD' : 'SAR';
        return {
          accountId: r.accountId,
          drift: r.drift,
          showWarning: r.showWarning,
          bookCurrency,
          accountLabel: a.name?.trim() || r.accountId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    const creditExceptions = accounts
      .filter((a) => a.type === 'Credit')
      .map((a) => {
        const r = reconcileCreditAccountBalance(a as Account, transactions);
        if (r == null || !r.showWarning) return null;
        const bookCurrency: 'USD' | 'SAR' = a.currency === 'USD' ? 'USD' : 'SAR';
        return {
          accountId: r.accountId,
          drift: r.drift,
          showWarning: r.showWarning,
          bookCurrency,
          accountLabel: a.name?.trim() || r.accountId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    const holdings: Holding[] = getPersonalInvestments(financialData).flatMap((p) => (p.holdings ?? [])) as Holding[];
    const invAccountIds = new Set(accounts.filter((a) => a.type === 'Investment').map((a) => a.id));
    const investmentTxs: InvestmentTransaction[] = (financialData.investmentTransactions ?? []).filter((t) =>
      invAccountIds.has((t as InvestmentTransaction).accountId ?? '')
    ) as InvestmentTransaction[];

    const investmentKpiReconciliation: InvestmentKpiReconciliation | null = (() => {
      const getAvailableCash = appDataCtx?.getAvailableCashForAccount;
      if (!getAvailableCash) return null;

      const b = computePersonalInvestmentKpiBreakdown(financialData, rate, getAvailableCash);

      let brokerageCashRawSar = 0;
      for (const account of accounts) {
        if (account.type !== 'Investment' || !personalAccountIds.has(account.id)) continue;
        const cash = getAvailableCash(account.id);
        brokerageCashRawSar += tradableCashBucketToSARSigned({ SAR: cash?.SAR ?? 0, USD: cash?.USD ?? 0 }, rate);
      }

      const expectedCashFromLedgerSar =
        b.depositsRecordedSar -
        b.buysSar +
        b.sellsSar +
        b.dividendsSar -
        b.totalWithdrawnSar -
        b.feesSar -
        b.vatSar;
      const cashLedgerDriftSar = brokerageCashRawSar - expectedCashFromLedgerSar;

      const getCashStrict = (id: string) => {
        const c = getAvailableCash(id);
        return { SAR: c?.SAR ?? 0, USD: c?.USD ?? 0 };
      };
      const emptyPrices: SimulatedPriceMap = {};
      const { subtotalSAR: platformsRollupSar } = computePersonalPlatformsRollupSAR(financialData, rate, emptyPrices, getCashStrict);
      const { valueSAR: commoditiesValueSar } = computePersonalCommoditiesContributionSAR(financialData, rate, emptyPrices);
      const allCommodities = getPersonalCommodityHoldings(financialData);
      const commodityCostSar = allCommodities.reduce((sum, ch) => sum + toSAR(ch.purchaseValue ?? 0, 'USD', rate), 0);
      const { personalAssets } = getPersonalWealthData(financialData);
      const sukukAssets = (personalAssets ?? []).filter((a) => a?.type === 'Sukuk');
      const sukukAssetsValueSAR = sukukAssets.reduce((sum, a) => sum + Math.max(0, Number(a?.value) || 0), 0);
      const sukukAssetsCostSAR = sukukAssets.reduce((sum, a) => {
        const v = Math.max(0, Number(a?.value) || 0);
        const pp = Number(a?.purchasePrice);
        const cost = Number.isFinite(pp) && pp > 0 ? pp : v;
        return sum + cost;
      }, 0);
      const headlineTotalValueSar = platformsRollupSar + commoditiesValueSar + sukukAssetsValueSAR;
      const headlineNetCapitalSar = Math.max(0, b.netCapitalSar + commodityCostSar + sukukAssetsCostSAR);
      const headlineGainLossSar = headlineTotalValueSar - headlineNetCapitalSar;

      const notes: string[] = [];
      if (!(b.depositsRecordedSar > 0) && (b.buysSar > 0 || b.sellsSar > 0)) {
        notes.push(
          'No deposit transactions found — net capital uses ledger-inferred or average-cost fallback (see capital source). Add deposits/withdrawals that match your broker funding for trustworthy ROI.',
        );
      }
      if (b.capitalSource === 'ledger_inferred') {
        notes.push(
          'Ledger-inferred gross uses max(0, buys − sells − dividends + floored broker cash + withdrawals). Net capital is max(0, that gross − withdrawals again) — withdrawals appear twice in different roles; see step-by-step.',
        );
      }
      if (b.capitalSource === 'cost_basis_fallback') {
        notes.push(
          'Using holdings average-cost basis + broker cash + withdrawals as gross invested — use when there are no deposits and inferred ledger capital is zero.',
        );
      }
      if (Math.abs(cashLedgerDriftSar) > 50) {
        notes.push(
          'Cash drift uses signed broker cash (before per-currency flooring) vs the ledger identity. Large drift usually means missing trades, mis-tagged currency, or FX date mismatch.',
        );
      }
      if (b.feesSar > 0 || b.vatSar > 0) {
        notes.push('Fees/VAT reduce cash in the ledger identity and are expected to affect drift vs a deposits-only mental model.');
      }
      if (brokerageCashRawSar < -1) {
        notes.push(
          'Broker cash (signed) is negative — the transaction ledger implies more spending than recorded funding. KPI display still floors cash at zero per currency when summing value.',
        );
      }

      return {
        totalValueSar: b.totalInvestmentsValueSar,
        holdingsValueSar: b.holdingsValueSar,
        brokerageCashSar: b.brokerageCashSar,
        brokerageCashRawSar,
        netCapitalSar: b.netCapitalSar,
        totalGainLossSar: b.totalGainLossSar,
        roi: b.roi,
        capitalSource: b.capitalSource,
        depositsSar: b.depositsRecordedSar,
        withdrawalsSar: b.totalWithdrawnSar,
        buysSar: b.buysSar,
        sellsSar: b.sellsSar,
        dividendsSar: b.dividendsSar,
        feesSar: b.feesSar,
        vatSar: b.vatSar,
        inferredInvestedFromLedgerSar: b.inferredInvestedFromLedgerSar,
        holdingsCostBasisSar: b.holdingsCostBasisSar,
        fallbackInvestedSar: b.fallbackInvestedSar,
        expectedCashFromLedgerSar,
        cashLedgerDriftSar,
        investmentsHeadline: {
          totalValueSar: headlineTotalValueSar,
          platformsRollupSar,
          commoditiesValueSar,
          sukukValueSar: sukukAssetsValueSAR,
          commodityCostSar,
          sukukCostSar: sukukAssetsCostSAR,
          combinedNetCapitalSar: headlineNetCapitalSar,
          combinedGainLossSar: headlineGainLossSar,
        },
        notes,
      };
    })();

    const storedBySymbol = new Map<string, number>();
    holdings.forEach((h) => {
      const sym = String(h.symbol ?? '').toUpperCase();
      if (!sym) return;
      storedBySymbol.set(sym, (storedBySymbol.get(sym) ?? 0) + (Number(h.quantity) || 0));
    });

    const tradesBySymbol: Record<string, { symbol: string; type: 'buy' | 'sell'; quantity: number }[]> = {};
    investmentTxs.forEach((t) => {
      if (t.type !== 'buy' && t.type !== 'sell') return;
      const sym = String(t.symbol ?? '').toUpperCase();
      if (!sym) return;
      if (!tradesBySymbol[sym]) tradesBySymbol[sym] = [];
      tradesBySymbol[sym].push({ symbol: sym, type: t.type, quantity: Number(t.quantity) || 0 });
    });

    const allSymbols = new Set<string>([...storedBySymbol.keys(), ...Object.keys(tradesBySymbol)]);
    const holdingExceptions = Array.from(allSymbols).map((symbol) => {
      const stored = storedBySymbol.get(symbol) ?? 0;
      const trades = tradesBySymbol[symbol] ?? [];
      const holding = { id: `h-${symbol}`, symbol, quantity: stored };
      const rec = reconcileHoldings({ holding: holding as any, trades: trades as any });
      return { symbol, drift: rec.drift };
    }).filter((h) => Math.abs(h.drift) >= 0.0001);

    const reconciliation = reconciliationExceptionReport({
      cashExceptions: [...cashExceptions, ...creditExceptions],
      holdingExceptions,
    });

    const missingCategory = (transactions ?? []).some((t) => countsAsExpenseForCashflowKpi(t) && !t.budgetCategory);
    const firstCash = cashExceptions[0];
    const cashDrift = firstCash
      ? {
          accountId: firstCash.accountId,
          drift: firstCash.drift,
          accountName: firstCash.accountLabel,
          bookCurrency: firstCash.bookCurrency,
        }
      : undefined;
    const repairSuggestions = repairSuggestionEngine({ cashDrift, missingCategory });

    // Populate the in-memory exception queue so other UI can consume it later.
    clearExceptionQueue();
    const combined = [
      ...(integrity.exceptions ?? []),
      ...(brokenRefs ?? []),
      ...reconciliation.map((r) => ({
        code: `RECONCILE_${r.type.toUpperCase()}`,
        message: r.message,
        entity: r.type,
        entityId: r.id,
        severity: r.severity,
      })),
    ];
    if (investmentKpiReconciliation) {
      if (Math.abs(investmentKpiReconciliation.cashLedgerDriftSar) > 50) {
        combined.push({
          code: 'RECONCILE_INVESTMENT_CASH_LEDGER',
          message: `Investment cash drift: ${investmentKpiReconciliation.cashLedgerDriftSar.toFixed(2)} SAR (broker cash vs ledger flows)`,
          entity: 'investment',
          entityId: 'cash-ledger',
          severity: Math.abs(investmentKpiReconciliation.cashLedgerDriftSar) > 500 ? 'error' : 'warning',
        } as any);
      }
      if (investmentKpiReconciliation.totalGainLossSar < 0) {
        combined.push({
          code: 'KPI_INVESTMENT_UNREALIZED_NEGATIVE',
          message: `Investments show negative net gain/loss (${investmentKpiReconciliation.totalGainLossSar.toFixed(2)} SAR). This can be real performance, but verify reconciliation below.`,
          entity: 'investment',
          entityId: 'pnl',
          severity: 'warning',
        } as any);
      }
    }
    if (missingCategory) {
      combined.push({
        code: 'RECONCILE_BUDGET_MAPPING',
        message: 'Approved expense rows are missing budget mapping.',
        entity: 'transaction',
        entityId: 'budgetCategory',
        severity: 'warning',
      } as any);
    }
    combined.forEach((ex: any) => pushException(ex));
    const queue = getExceptionQueue();

    return {
      integrityOk: integrity.ok,
      integrityExceptions: integrity.exceptions,
      brokenRefs,
      cashExceptions,
      creditExceptions,
      holdingExceptions,
      reconciliation,
      investmentKpiReconciliation,
      repairSuggestions,
      queue,
    };
  }, [appDataCtx, exchangeRate]);

  const sarPerUsdHealth = useMemo(
    () => resolveSarPerUsd(appDataCtx?.data ?? null, exchangeRate),
    [appDataCtx?.data, exchangeRate]
  );

  const healthAiContext = useMemo((): SystemHealthAiContext => {
    const serviceLines = services
      .map((s) => {
        const ms = Number.isFinite(s.responseTime) ? ` (${s.responseTime} ms)` : '';
        const err = s.error ? ` — ${s.error}` : '';
        return `- ${s.name}: ${s.status}${ms}${err}`;
      })
      .join('\n');
    const integritySummaryLine = integritySummary
      ? `Queued ${integritySummary.queue?.length ?? 0} · Reconciliation ${integritySummary.reconciliation.length} · integrityOk=${integritySummary.integrityOk}`
      : 'Financial data not loaded — open Accounts after sign-in.';
    return {
      overallStatus,
      healthScore,
      degradedCount: smartInsights.degraded,
      outageCount: smartInsights.outages,
      avgLatencyMs: smartInsights.avgLatency,
      serviceLines,
      integritySummaryLine,
      sarPerUsd: sarPerUsdHealth,
      lastCheckedLabel: lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : undefined,
    };
  }, [
    services,
    overallStatus,
    healthScore,
    smartInsights.degraded,
    smartInsights.outages,
    smartInsights.avgLatency,
    integritySummary,
    lastCheckedAt,
    sarPerUsdHealth,
  ]);

  const OverallStatusCard: React.FC<{ status: ServiceStatus }> = ({ status }) => {
    const { text, icon } = getStatusInfo(status);
    const message = {
      Operational: 'All systems are running smoothly.',
      'Degraded Performance': 'Some services are slow or partially unavailable.',
      Outage: 'One or more critical services are down.',
      'Checking...': 'Running health checks...',
      Simulated: 'Simulation mode enabled.',
    }[status];

    return (
      <div className={`p-4 rounded-lg border-l-4 ${
        status === 'Operational' ? 'bg-green-50 border-green-500' :
        status === 'Degraded Performance' ? 'bg-yellow-50 border-yellow-500' :
        status === 'Outage' ? 'bg-red-50 border-red-500' :
        'bg-gray-50 border-gray-500'
      }`}>
        <div className="flex items-center">
          <div className="flex-shrink-0">{icon}</div>
          <div className="ml-3">
            <p className={`text-sm font-bold ${text}`}>{status}</p>
            <p className="text-sm text-gray-600">{message}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold text-dark">System & APIs Health</h1>
          <p className="text-sm text-slate-500 mt-1">
            Automated probes for Supabase, AI proxy (no full LLM on each tick), and Finnhub. Data checks use your <strong>personal</strong> ledger. FX reference for the app:{' '}
            <span className="font-mono tabular-nums">1 USD = {sarPerUsdHealth.toFixed(4)} SAR</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">Auto refresh in {nextRefreshIn}s</span>
          <button onClick={() => runHealthChecks('manual')} disabled={isLoading} className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
            <ArrowPathIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Checking...' : 'Run now'}
          </button>
        </div>
      </div>

      <OverallStatusCard status={overallStatus} />

      {appDataCtx?.data && <DashboardKpiQualityPanel />}

      {integritySummary && (
        <div className="bg-white shadow rounded-lg p-4 border border-slate-200">
          <div className="flex items-start gap-3">
            <div className="py-1">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Data integrity & reconciliation</h3>
              <p className="text-sm text-slate-600">
                {integritySummary.integrityOk ? 'Basic checks look good.' : 'Potential integrity issues detected.'}{' '}
                ({(integritySummary.queue?.length ?? 0)} exception(s))
              </p>
              {integritySummary.reconciliation.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  Reconciliation warnings: {integritySummary.reconciliation.length} (cash + credit + holdings + budget mapping checks).
                </p>
              )}
              {(integritySummary.creditExceptions?.length ?? 0) > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  Credit-account drift warnings: {integritySummary.creditExceptions.length}.
                </p>
              )}
            </div>
          </div>

          {integritySummary.queue?.length ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 mb-2">Top issues</p>
              <ul className="space-y-2 max-h-44 overflow-y-auto pr-2">
                {integritySummary.queue.slice(0, 8).map((ex, i) => (
                  <li key={`${ex.code}-${ex.entityId ?? i}-${i}`} className="text-sm border border-slate-200 rounded-lg p-2 bg-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${ex.severity === 'error' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                        {ex.severity.toUpperCase()}
                      </span>
                      <span className="font-medium text-slate-800">{ex.message}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-emerald-800 mt-3">No exceptions queued.</p>
          )}

          {integritySummary.repairSuggestions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-500 mb-2">Repair suggestions</p>
              <ul className="space-y-1 text-sm text-slate-700">
                {integritySummary.repairSuggestions.map((s, i) => (
                  <li key={`repair-${i}`}>
                    {s.action}
                    {s.detail ? ` — ${s.detail}` : ''}
                    {s.entityId ? ` · id ${s.entityId}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {integritySummary.investmentKpiReconciliation && (
            <div id="investment-kpi-reconciliation" className="mt-4 pt-4 border-t border-slate-200 scroll-mt-20">
              <h4 className="text-sm font-semibold text-slate-800">Investment KPI reconciliation</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                <strong>Stocks + broker cash</strong> uses one shared engine (<code className="text-[11px]">investmentKpiCore</code>). The Investments page <strong>headline</strong> adds commodities and Sukuk on top — both are spelled out below so numbers cannot silently disagree.
              </p>

              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mt-3 mb-1">A — Stocks &amp; broker cash only (canonical)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total value (SAR)</p>
                  <p className="font-semibold tabular-nums text-slate-900">{integritySummary.investmentKpiReconciliation.totalValueSar.toFixed(2)}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Holdings {integritySummary.investmentKpiReconciliation.holdingsValueSar.toFixed(2)} + broker cash {integritySummary.investmentKpiReconciliation.brokerageCashSar.toFixed(2)}{' '}
                    <span className="text-slate-500">(cash floored per currency before SAR sum)</span>
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Net capital (SAR)</p>
                  <p className="font-semibold tabular-nums text-slate-900">{integritySummary.investmentKpiReconciliation.netCapitalSar.toFixed(2)}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    max(0, gross invested − withdrawals). Gross ={' '}
                    <span className="font-medium">
                      {integritySummary.investmentKpiReconciliation.capitalSource === 'deposits' && 'sum(deposits)'}
                      {integritySummary.investmentKpiReconciliation.capitalSource === 'ledger_inferred' && 'ledger-inferred (see detail)'}
                      {integritySummary.investmentKpiReconciliation.capitalSource === 'cost_basis_fallback' && 'cost-basis fallback (see detail)'}
                    </span>
                  </p>
                </div>
                <div className={`rounded-lg border p-3 ${
                  integritySummary.investmentKpiReconciliation.totalGainLossSar >= 0
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-rose-200 bg-rose-50/60'
                }`}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Net gain/loss (SAR)</p>
                  <p className={`font-semibold tabular-nums ${
                    integritySummary.investmentKpiReconciliation.totalGainLossSar >= 0 ? 'text-emerald-800' : 'text-rose-800'
                  }`}>
                    {integritySummary.investmentKpiReconciliation.totalGainLossSar.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">total value − net capital (unrealized on this slice)</p>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ROI (stocks slice)</p>
                  <p className="font-semibold tabular-nums text-indigo-900">
                    {(integritySummary.investmentKpiReconciliation.roi * 100).toFixed(2)}%
                  </p>
                  <p className="text-xs text-slate-600 mt-1">gain/loss ÷ net capital</p>
                </div>
              </div>

              <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800 select-none">
                  Net capital — step-by-step (same order as code)
                </summary>
                <div className="mt-2 space-y-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-800">Deposit path</p>
                  <ul className="list-none space-y-0.5 tabular-nums pl-0">
                    <li>Deposits (sum of deposit transactions, SAR): {integritySummary.investmentKpiReconciliation.depositsSar.toFixed(2)}</li>
                    <li>Withdrawals (sum, SAR): {integritySummary.investmentKpiReconciliation.withdrawalsSar.toFixed(2)}</li>
                  </ul>
                  <p className="font-semibold text-slate-800 pt-1">If deposits = 0 — ledger-inferred gross invested</p>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    inferredGross = max(0, buys − sells − dividends + floored broker cash + withdrawals) ={' '}
                    {integritySummary.investmentKpiReconciliation.inferredInvestedFromLedgerSar.toFixed(2)}
                  </p>
                  <p className="tabular-nums text-slate-800 pt-1">
                    → net capital = max(0, inferredGross − withdrawals) = max(0,{' '}
                    {integritySummary.investmentKpiReconciliation.inferredInvestedFromLedgerSar.toFixed(2)} −{' '}
                    {integritySummary.investmentKpiReconciliation.withdrawalsSar.toFixed(2)}) ={' '}
                    {integritySummary.investmentKpiReconciliation.netCapitalSar.toFixed(2)}{' '}
                    <span className="text-slate-500 font-normal">
                      (only when this path beats deposits and fallback)
                    </span>
                  </p>
                  <p className="font-semibold text-slate-800 pt-1">If that is also 0 — cost-basis fallback gross</p>
                  <ul className="list-none space-y-0.5 tabular-nums">
                    <li>Holdings avg-cost basis (SAR): {integritySummary.investmentKpiReconciliation.holdingsCostBasisSar.toFixed(2)}</li>
                    <li>+ broker cash (SAR, floored): {integritySummary.investmentKpiReconciliation.brokerageCashSar.toFixed(2)}</li>
                    <li>+ withdrawals (SAR): {integritySummary.investmentKpiReconciliation.withdrawalsSar.toFixed(2)}</li>
                    <li className="font-semibold">→ fallback gross (max with 0): {integritySummary.investmentKpiReconciliation.fallbackInvestedSar.toFixed(2)}</li>
                  </ul>
                  <p className="pt-2 border-t border-slate-100 font-semibold text-slate-900">
                    Net capital shown = max(0, chosen gross invested − withdrawals) = {integritySummary.investmentKpiReconciliation.netCapitalSar.toFixed(2)}{' '}
                    <span className="font-normal text-slate-600">
                      (capital source: {integritySummary.investmentKpiReconciliation.capitalSource})
                    </span>
                  </p>
                </div>
              </details>

              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-1">B — Investments page headline (includes commodities &amp; Sukuk)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg border border-slate-200 bg-amber-50/40 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Headline total value</p>
                  <p className="font-semibold tabular-nums text-slate-900">
                    {integritySummary.investmentKpiReconciliation.investmentsHeadline.totalValueSar.toFixed(2)} SAR
                  </p>
                  <p className="text-xs text-slate-600 mt-1 tabular-nums leading-relaxed">
                    Platforms {integritySummary.investmentKpiReconciliation.investmentsHeadline.platformsRollupSar.toFixed(2)} + commodities{' '}
                    {integritySummary.investmentKpiReconciliation.investmentsHeadline.commoditiesValueSar.toFixed(2)} + Sukuk{' '}
                    {integritySummary.investmentKpiReconciliation.investmentsHeadline.sukukValueSar.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-amber-50/40 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Headline net capital</p>
                  <p className="font-semibold tabular-nums text-slate-900">
                    {integritySummary.investmentKpiReconciliation.investmentsHeadline.combinedNetCapitalSar.toFixed(2)} SAR
                  </p>
                  <p className="text-xs text-slate-600 mt-1 tabular-nums leading-relaxed">
                    Stocks net capital {integritySummary.investmentKpiReconciliation.netCapitalSar.toFixed(2)} + commodity cost {integritySummary.investmentKpiReconciliation.investmentsHeadline.commodityCostSar.toFixed(2)} + Sukuk cost{' '}
                    {integritySummary.investmentKpiReconciliation.investmentsHeadline.sukukCostSar.toFixed(2)}
                  </p>
                </div>
                <div className={`rounded-lg border p-3 ${
                  integritySummary.investmentKpiReconciliation.investmentsHeadline.combinedGainLossSar >= 0
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-rose-200 bg-rose-50/60'
                }`}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Headline net gain/loss</p>
                  <p className={`font-semibold tabular-nums ${
                    integritySummary.investmentKpiReconciliation.investmentsHeadline.combinedGainLossSar >= 0 ? 'text-emerald-800' : 'text-rose-800'
                  }`}>
                    {integritySummary.investmentKpiReconciliation.investmentsHeadline.combinedGainLossSar.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">headline value − headline net capital</p>
                </div>
              </div>

              <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800 select-none">
                  Ledger flow breakdown &amp; cash drift (signed broker cash)
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="font-semibold text-slate-700">Ledger totals (SAR)</p>
                    <p className="tabular-nums text-slate-700 mt-1">Buys: {integritySummary.investmentKpiReconciliation.buysSar.toFixed(2)}</p>
                    <p className="tabular-nums text-slate-700">Sells: {integritySummary.investmentKpiReconciliation.sellsSar.toFixed(2)}</p>
                    <p className="tabular-nums text-slate-700">Dividends: {integritySummary.investmentKpiReconciliation.dividendsSar.toFixed(2)}</p>
                    <p className="tabular-nums text-slate-700">Fees: {integritySummary.investmentKpiReconciliation.feesSar.toFixed(2)}</p>
                    <p className="tabular-nums text-slate-700">VAT: {integritySummary.investmentKpiReconciliation.vatSar.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="font-semibold text-slate-700">Expected cash (ledger identity)</p>
                    <p className="tabular-nums text-slate-900 mt-1">{integritySummary.investmentKpiReconciliation.expectedCashFromLedgerSar.toFixed(2)} SAR</p>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      deposits − buys + sells + dividends − withdrawals − fees − VAT
                    </p>
                  </div>
                  <div className={`rounded-lg border p-2 ${
                    Math.abs(integritySummary.investmentKpiReconciliation.cashLedgerDriftSar) <= 50
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-amber-200 bg-amber-50/60'
                  }`}>
                    <p className="font-semibold text-slate-700">Cash drift (signed broker − expected)</p>
                    <p
                      className={`tabular-nums mt-1 font-semibold ${
                        Math.abs(integritySummary.investmentKpiReconciliation.cashLedgerDriftSar) <= 50 ? 'text-emerald-800' : 'text-amber-900'
                      }`}
                    >
                      {integritySummary.investmentKpiReconciliation.cashLedgerDriftSar.toFixed(2)} SAR
                    </p>
                    <p className="tabular-nums text-slate-700 mt-1">
                      Broker signed SAR: {integritySummary.investmentKpiReconciliation.brokerageCashRawSar.toFixed(2)}
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      {Math.abs(integritySummary.investmentKpiReconciliation.cashLedgerDriftSar) <= 50
                        ? 'Looks consistent.'
                        : 'Likely missing entries, wrong currency tags, or FX date mismatch.'}
                    </p>
                  </div>
                </div>

                {(integritySummary.investmentKpiReconciliation.notes?.length ?? 0) > 0 && (
                  <ul className="mt-3 text-xs text-slate-700 space-y-1 list-disc pl-5">
                    {integritySummary.investmentKpiReconciliation.notes.map((n: string, i: number) => (
                      <li key={`inv-note-${i}`}>{n}</li>
                    ))}
                  </ul>
                )}
              </details>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric title="Health score" value={`${healthScore}/100`} tone={healthScore >= 85 ? 'good' : healthScore >= 60 ? 'warn' : 'bad'} />
        <Metric title="Degraded services" value={String(smartInsights.degraded)} tone={smartInsights.degraded > 0 ? 'warn' : 'good'} />
        <Metric title="Outages" value={String(smartInsights.outages)} tone={smartInsights.outages > 0 ? 'bad' : 'good'} />
        <Metric title="Avg latency" value={`${smartInsights.avgLatency} ms`} tone={smartInsights.avgLatency > 1800 ? 'warn' : 'good'} />
      </div>

      <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Smart Recommendations</h3>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
          {smartInsights.recommendations.map((item, idx) => <li key={`rec-${idx}`}>{item}</li>)}
        </ul>
        {lastCheckedAt && <p className="text-xs text-slate-500 mt-2">Last checked: {new Date(lastCheckedAt).toLocaleString()}</p>}
      </div>

      {(marketStatus || marketHolidays.length > 0) && (
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <h3 className="text-lg font-semibold text-dark mb-2">Finnhub: Market status & holidays</h3>
          {marketStatus && (
            <p className="text-sm text-gray-700">
              US: <span className={marketStatus.isOpen ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>{marketStatus.isOpen ? 'Open' : 'Closed'}</span>
              {marketStatus.session && marketStatus.session !== 'unknown' && ` · ${marketStatus.session}`}
              {marketStatus.tztime && ` · ${marketStatus.tztime}`}
            </p>
          )}
          {marketHolidays.length > 0 && (
            <p className="text-sm text-gray-600 mt-1">Upcoming holidays: {marketHolidays.map((h) => `${h.name} (${h.date})`).join(', ')}</p>
          )}
        </div>
      )}

      <AIAdvisor
        pageContext="systemHealth"
        contextData={healthAiContext}
        title="AI system brief"
        subtitle="Operational summary · English / العربية"
        buttonLabel="Summarize system health"
      />

      <div className="bg-blue-50 border-l-4 border-blue-400 text-blue-800 p-4 rounded-r-lg shadow-sm">
        <div className="flex">
          <div className="py-1"><LightBulbIcon className="h-6 w-6 text-blue-500 mr-3" /></div>
          <div>
            <p className="font-bold">AI Service Troubleshooting</p>
            <p className="text-sm mt-1">
              The health check calls the same proxy as the app with a lightweight <code className="text-xs bg-blue-100 px-1 rounded">health</code> ping (no full model generation). An &quot;Outage&quot; usually means the function is not deployed or no provider key is configured. Market rows use <code className="text-xs bg-blue-100 px-1 rounded">VITE_FINNHUB_API_KEY</code>.
            </p>
            <a href="https://docs.netlify.com/functions/overview/" target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:underline mt-2 inline-block">
              Learn about Netlify Functions &rarr;
            </a>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <ul className="divide-y divide-gray-200">
          {services.map((service) => {
            const { icon, text } = getStatusInfo(service.status);
            return (
              <li key={service.name} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center">
                <div className="flex-1">
                  <p className="font-medium text-dark">{service.name}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {icon}
                    <span className={`text-sm font-semibold ${text}`}>{service.status}</span>
                  </div>
                  {service.error && (
                    <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded-md border border-red-200">
                      <strong>Error:</strong> {service.error}
                    </div>
                  )}
                </div>
                <div className="text-left sm:text-right mt-2 sm:mt-0">
                  <p className="font-semibold text-dark">{service.responseTime ? `${service.responseTime} ms` : service.status === 'Checking...' ? '...' : '--'}</p>
                  <p className="text-xs text-gray-500">Response Time</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="bg-white shadow rounded-lg p-4 border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Recent incident timeline</h3>
        {incidents.length === 0 ? (
          <p className="text-sm text-slate-500">No degraded/outage incidents recorded yet.</p>
        ) : (
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {incidents.slice(0, 8).map((inc, idx) => (
              <li key={`${inc.at}-${inc.service}-${idx}`} className="text-sm border rounded p-2 bg-slate-50">
                <span className="font-medium text-slate-800">{inc.service}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${inc.status === 'Outage' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{inc.status}</span>
                <p className="text-xs text-slate-500 mt-1">{new Date(inc.at).toLocaleString()}</p>
                {inc.message && <p className="text-xs text-slate-600 mt-1">{inc.message}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

function Metric({ title, value, tone }: { title: string; value: string; tone: 'good' | 'warn' | 'bad' }) {
  const toneClasses = tone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-800';
  return (
    <div className={`rounded-lg border p-3 ${toneClasses}`}>
      <p className="text-xs opacity-80">{title}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

export default SystemHealth;
