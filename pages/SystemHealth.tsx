import React, { useState, useCallback, useContext, useMemo, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Page } from '../types';
import { invokeAI } from '../services/geminiService';
import { getMarketStatus, getMarketHolidays, finnhubFetch, type MarketStatusItem, type MarketHoliday } from '../services/finnhubService';
import { MarketDataContext } from '../context/MarketDataContext';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { CloudIcon } from '../components/icons/CloudIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';

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
  { name: 'Multi-user Access', status: 'Operational' },
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

const SystemHealth: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage: _setActivePage }) => {
  const [services, setServices] = useState<Service[]>(initialServices);
  const [isLoading, setIsLoading] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatusItem | null>(null);
  const [marketHolidays, setMarketHolidays] = useState<MarketHoliday[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
  const [incidents, setIncidents] = useState<HealthIncident[]>([]);
  const marketContext = useContext(MarketDataContext);

  const runHealthChecks = useCallback(async (trigger: 'manual' | 'auto' = 'manual') => {
    setIsLoading(true);
    setServices((current) => current.map((s) =>
      s.status !== 'Simulated' ? { ...s, status: 'Checking...', responseTime: undefined, error: undefined } : s
    ));

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
        const start = performance.now();
        await invokeAI({ model: 'gemini-3-flash-preview', contents: 'health-check' });
        const duration = Math.round(performance.now() - start);
        return { status: duration > 3000 ? 'Degraded Performance' : 'Operational', responseTime: duration };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'AI service check failed.';
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
        const price = Number(quote?.c);
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
        if (!count || count < 2) {
          return { status: 'Degraded Performance', responseTime: duration, error: 'System is active but only one user profile is currently detected.' };
        }
        return { status: duration > 1500 ? 'Degraded Performance' : 'Operational', responseTime: duration };
      } catch {
        return { status: 'Outage', error: 'Could not verify multi-user access from users table.' };
      }
    };

    const [auth, db, ai, finnhub, multiUser] = await Promise.all([
      checkSupabaseAuth(),
      checkSupabaseDB(),
      checkAIService(),
      checkFinnhubService(),
      checkMultiUserAccess(),
    ]);

    const newServices = services.map((s) => {
      if (s.name.includes('Authentication')) return { ...s, ...auth };
      if (s.name.includes('Database')) return { ...s, ...db };
      if (s.name.includes('AI Services')) return { ...s, ...ai };
      if (s.name.includes('Market Data API (Finnhub)')) return { ...s, ...finnhub };
      if (s.name.includes('Multi-user Access')) return { ...s, ...multiUser };
      return s;
    });
    setServices(newServices);

    const nowIso = new Date().toISOString();
    setLastCheckedAt(nowIso);
    setNextRefreshIn(AUTO_REFRESH_SECONDS);

    const newIncidents = newServices
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

    if (trigger === 'auto') {
      setServices((current) => current.map((s) => s.status === 'Checking...' ? { ...s, status: 'Degraded Performance', error: s.error || 'Auto-check completed with incomplete telemetry.' } : s));
    }
    setIsLoading(false);
  }, [services, marketContext?.isLive, marketContext ? Object.keys(marketContext.simulatedPrices).length : 0]);

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
    const avgLatency = services.filter((s) => Number.isFinite(s.responseTime)).reduce((sum, s, _, arr) => {
      const count = arr.filter((x) => Number.isFinite(x.responseTime)).length || 1;
      return sum + (s.responseTime || 0) / count;
    }, 0);
    const topIncident = incidents[0];

    const recommendations: string[] = [];
    if (outages > 0) recommendations.push('Resolve active outages first (credentials, deployment, or API quota).');
    if (degraded > 0) recommendations.push('Degraded services detected: tune retries/timeouts and check upstream response ceilings.');
    if (avgLatency > 1800) recommendations.push('Average latency is high; consider lighter probes and cache warmup windows.');
    if (!recommendations.length) recommendations.push('All key services are healthy. Keep auto-check cadence active for early anomaly detection.');

    return { degraded, outages, avgLatency: Math.round(avgLatency), topIncident, recommendations: recommendations.slice(0, 3) };
  }, [services, incidents]);

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
          <p className="text-sm text-slate-500 mt-1">Fully automated reliability center with continuous checks, incident memory, and smart recommendations.</p>
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
              {marketStatus.session && ` · ${marketStatus.session}`}
              {marketStatus.tztime && ` · ${marketStatus.tztime}`}
            </p>
          )}
          {marketHolidays.length > 0 && (
            <p className="text-sm text-gray-600 mt-1">Upcoming holidays: {marketHolidays.map((h) => `${h.name} (${h.date})`).join(', ')}</p>
          )}
        </div>
      )}

      <div className="bg-blue-50 border-l-4 border-blue-400 text-blue-800 p-4 rounded-r-lg shadow-sm">
        <div className="flex">
          <div className="py-1"><LightBulbIcon className="h-6 w-6 text-blue-500 mr-3" /></div>
          <div>
            <p className="font-bold">AI Service Troubleshooting</p>
            <p className="text-sm mt-1">For AI features to work, a Netlify Function acts as a secure proxy. An "Outage" status usually means this function isn't deployed or the `GEMINI_API_KEY` is missing. Live market API outages are commonly due to a missing/invalid `VITE_FINNHUB_API_KEY`.</p>
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
