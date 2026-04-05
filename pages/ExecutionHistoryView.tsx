import React, { useMemo, useContext, useState } from 'react';
import { DataContext } from '../context/DataContext';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ClockIcon } from '../components/icons/ClockIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import InfoHint from '../components/InfoHint';
import type { TradeCurrency } from '../types';

/** Align localStorage / API rows with the same numeric fields as DataContext.normalizeExecutionLog */
function normalizeExecutionRow(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  const st = raw.status ?? raw.executionStatus ?? '';
  return {
    ...raw,
    id: raw.id,
    created_at: raw.created_at,
    date: raw.date ?? raw.timestamp ?? '',
    totalInvestment: Number(raw.total_investment ?? raw.totalInvestment ?? 0),
    coreInvestment: Number(raw.core_investment ?? raw.coreInvestment ?? 0),
    upsideInvestment: Number(raw.upside_investment ?? raw.upsideInvestment ?? 0),
    speculativeInvestment: Number(raw.speculative_investment ?? raw.speculativeInvestment ?? 0),
    redirectedInvestment: Number(raw.redirected_investment ?? raw.redirectedInvestment ?? 0),
    unusedUpsideFunds: Number(raw.unused_upside_funds ?? raw.unusedUpsideFunds ?? 0),
    trades: Array.isArray(raw.trades) ? raw.trades : [],
    status: st,
    log_details: String(raw.log_details ?? raw.logDetails ?? ''),
  };
}

function bucketExecutionStatus(log: any): 'success' | 'failure' | 'other' {
  const s = String(log.status ?? log.executionStatus ?? '').toLowerCase();
  if (s === 'success' || s === 'ok' || s === 'completed') return 'success';
  if (s === 'failure' || s === 'failed' || s === 'error') return 'failure';
  return 'other';
}

function plainLanguageExecutionNote(logDetails: string): { headline: string; technical: string } {
  const text = (logDetails || '').trim();
  if (!text) return { headline: 'No extra detail was saved for this run.', technical: '' };
  const t = text.slice(0, 12000);
  const lower = t.toLowerCase();
  if (/403|401|402|429/.test(lower) || /credits?|licenses?|subscription|billing/.test(lower)) {
    return {
      headline:
        'The AI step could not run—often because the AI provider account needs credits, a license, or a valid API key. The app may still show a rule-based backup result below. Check provider billing or your API key in settings, then try again.',
      technical: t,
    };
  }
  if (/not configured|api key|unavailable|timeout|network|econn|503|502|fetch failed/i.test(t)) {
    return {
      headline:
        'The AI service was not reachable or is not configured. Any numbers below may come from the app’s non-AI rules only.',
      technical: t,
    };
  }
  return {
    headline: 'Below is the full log from this run (useful if you contact support).',
    technical: t,
  };
}

const ExecutionHistoryView: React.FC = () => {
  const { data, loading } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const [filterStatus, setFilterStatus] = useState<'All' | 'success' | 'failure'>('All');

  const planCurrency: TradeCurrency = (data?.investmentPlan?.budgetCurrency as TradeCurrency) || 'SAR';

  const { allExecutionLogs, executionLogs } = useMemo(() => {
    let logs: any[] = [];

    if (data?.executionLogs && Array.isArray(data.executionLogs)) {
      logs = [...data.executionLogs];
    }

    const storageKeys = [
      'investment-execution-logs',
      'investmentPlanExecutionLogs',
      'execution-logs',
      'change-logs',
      'investment-change-logs',
    ];

    for (const key of storageKeys) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            logs = [...logs, ...parsed.map(normalizeExecutionRow)];
          } else if (parsed && typeof parsed === 'object') {
            const chunk = parsed.logs || [parsed];
            logs = [...logs, ...chunk.map(normalizeExecutionRow)];
          }
        }
      } catch {
        /* ignore */
      }
    }

    logs = logs.map((row) => normalizeExecutionRow(row));

    const uniqueLogs = Array.from(
      new Map(
        logs.map((log: any) => [
          log.id || `${log.date || log.created_at || log.timestamp}-${log.total_investment ?? log.totalInvestment ?? 0}`,
          log,
        ]),
      ).values(),
    );

    const sortedAll = uniqueLogs.sort((a: any, b: any) => {
      const dateA = new Date(a.created_at || a.date || a.timestamp || 0).getTime();
      const dateB = new Date(b.created_at || b.date || b.timestamp || 0).getTime();
      return dateB - dateA;
    });

    const filtered = sortedAll.filter((log: any) => {
      if (filterStatus === 'All') return true;
      const b = bucketExecutionStatus(log);
      if (filterStatus === 'success') return b === 'success';
      if (filterStatus === 'failure') return b === 'failure';
      return false;
    });

    return { allExecutionLogs: sortedAll, executionLogs: filtered };
  }, [data?.executionLogs, filterStatus]);

  const runStats = useMemo(() => {
    let success = 0;
    let failure = 0;
    for (const log of allExecutionLogs) {
      const b = bucketExecutionStatus(log);
      if (b === 'success') success += 1;
      else if (b === 'failure') failure += 1;
    }
    return { total: allExecutionLogs.length, success, failure };
  }, [allExecutionLogs]);

  if (loading || !data) {
    return (
      <div className="page-container flex items-center justify-center min-h-[24rem]" aria-busy="true">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-label="Loading execution history" />
          <span className="text-sm text-slate-600">Loading execution history…</span>
        </div>
      </div>
    );
  }

  const fmtPlan = (n: number) => formatCurrencyString(n ?? 0, { digits: 0, inCurrency: planCurrency });

  const listBody =
    executionLogs.length === 0 && allExecutionLogs.length > 0 ? (
      <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/80">
        <p className="text-slate-700 font-medium">No runs match this filter.</p>
        <p className="text-sm text-slate-500 mt-1">Try &quot;All&quot; or pick the other status.</p>
        <button
          type="button"
          onClick={() => setFilterStatus('All')}
          className="mt-4 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-secondary"
        >
          Show all
        </button>
      </div>
    ) : executionLogs.length === 0 ? (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full mx-auto mb-6 flex items-center justify-center">
          <ClockIcon className="h-10 w-10 text-slate-400" />
        </div>
        <p className="text-xl font-semibold text-slate-600 mb-2">No plan runs logged yet</p>
        <p className="text-slate-500 mb-4 max-w-md mx-auto">
          When you <strong>execute</strong> your monthly investment plan (Investment Plan tab), each run is stored here so you can review outcomes and errors.
        </p>
        <button
          type="button"
          onClick={() => {
            const event = new CustomEvent('navigateToTab', { detail: 'Investment Plan' });
            window.dispatchEvent(event);
          }}
          className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-secondary transition-colors inline-flex items-center gap-2"
        >
          <ClipboardDocumentListIcon className="h-5 w-5" />
          Go to Investment Plan
        </button>
      </div>
    ) : (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              const csv = [
                ['Date', 'Status', 'Total Investment', 'Core', 'High-Upside', 'Speculative', 'Trades Count', `Currency (${planCurrency})`].join(','),
                ...executionLogs.map((log: any) => {
                  const date = log.created_at || log.date || log.timestamp;
                  const dateStr = date ? new Date(date).toISOString().split('T')[0] : '';
                  const b = bucketExecutionStatus(log);
                  const stLabel = b === 'success' ? 'success' : b === 'failure' ? 'failure' : 'other';
                  return [
                    dateStr,
                    stLabel,
                    log.totalInvestment ?? 0,
                    log.coreInvestment ?? 0,
                    log.upsideInvestment ?? 0,
                    log.speculativeInvestment ?? 0,
                    Array.isArray(log.trades) ? log.trades.length : 0,
                    planCurrency,
                  ].join(',');
                }),
              ].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `execution-history-${new Date().toISOString().split('T')[0]}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className="px-4 py-2 text-sm font-medium bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
          >
            Export filtered to CSV
          </button>
        </div>
        <div className="space-y-4">
          {executionLogs.map((log: any, index: number) => {
            const executionDate = log.created_at || log.date;
            const dateObj = executionDate ? new Date(executionDate) : new Date();
            const outcome = bucketExecutionStatus(log);
            const ok = outcome === 'success';
            const plain = log.log_details ? plainLanguageExecutionNote(log.log_details) : null;
            const failurePlain =
              plain?.headline ??
              'This run did not finish successfully. If you expected trades, open Investment Plan and set a monthly budget above zero, then run again.';

            return (
              <div
                key={log.id || index}
                className={`rounded-xl border p-5 sm:p-6 ${
                  ok ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'
                }`}
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                      {ok ? (
                        <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
                      ) : (
                        <ExclamationTriangleIcon className="h-6 w-6 text-rose-600" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-slate-900">{ok ? 'Execution succeeded' : 'Execution did not complete as planned'}</h3>
                      <p className="text-sm text-slate-600">
                        {dateObj.toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                    {(outcome === 'other' ? 'UNKNOWN' : outcome).toUpperCase()}
                  </span>
                </div>

                {!ok && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-950">
                    <p className="font-semibold text-amber-900">In plain language</p>
                    <p className="mt-1 leading-relaxed">{failurePlain}</p>
                  </div>
                )}

                {log.log_details && (
                  <div className="mt-2 p-4 bg-white/70 backdrop-blur-sm rounded-xl border border-slate-200">
                    <p className="text-sm font-semibold text-slate-700 mb-2">Technical details</p>
                    {plain?.technical && plain.technical.length > 400 ? (
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Show full log</summary>
                        <div className="prose prose-sm max-w-none text-slate-600 mt-2">
                          <SafeMarkdownRenderer content={log.log_details} />
                        </div>
                      </details>
                    ) : (
                      <div className="prose prose-sm max-w-none text-slate-600">
                        <SafeMarkdownRenderer content={log.log_details} />
                      </div>
                    )}
                  </div>
                )}

                {log.totalInvestment != null && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Investment</p>
                      <p className="text-lg font-bold text-slate-900">{fmtPlan(log.totalInvestment ?? 0)}</p>
                    </div>
                    {log.coreInvestment != null && (
                      <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Core</p>
                        <p className="text-lg font-bold text-slate-900">{fmtPlan(log.coreInvestment ?? 0)}</p>
                      </div>
                    )}
                    {log.upsideInvestment != null && (
                      <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">High-Upside</p>
                        <p className="text-lg font-bold text-slate-900">{fmtPlan(log.upsideInvestment ?? 0)}</p>
                      </div>
                    )}
                    {log.trades && Array.isArray(log.trades) && (
                      <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Trades Proposed</p>
                        <p className="text-lg font-bold text-slate-900">{log.trades.length}</p>
                      </div>
                    )}
                  </div>
                )}
                {log.trades && Array.isArray(log.trades) && log.trades.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-200">
                    <p className="text-sm font-semibold text-slate-700 mb-2">Proposed trades ({log.trades.length})</p>
                    <div className="space-y-1">
                      {log.trades.slice(0, 5).map((trade: any, idx: number) => (
                        <div key={idx} className="text-xs text-slate-600 bg-slate-50 rounded p-2">
                          <span className="font-semibold">{trade.ticker}</span>: {fmtPlan(trade.amount ?? 0)} — {trade.reason || 'N/A'}
                        </div>
                      ))}
                      {log.trades.length > 5 && <p className="text-xs text-slate-500 italic">+ {log.trades.length - 5} more trades</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );

  return (
    <div className="page-container space-y-6 min-h-[28rem]">
      <section className="section-card p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 shrink-0 bg-primary/10 rounded-xl flex items-center justify-center">
              <ClockIcon className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="page-title text-2xl sm:text-3xl">Execution History</h2>
              <p className="text-slate-600 mt-1 max-w-3xl">
                A <strong>read-only log</strong> of monthly <strong>investment plan runs</strong>—each time the app generated proposed orders from your budget and universe (Investment Plan → execute / automate). Use it to see whether a run
                finished, how much was allocated to Core vs High-Upside, and which tickers were proposed—not to replace your broker&apos;s trade confirmations.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
            <span className="text-xs text-slate-500 flex items-center gap-1 justify-end">
              Filter
              <InfoHint text="Narrows the list below. CSV export includes only the rows you see after filtering." />
            </span>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setFilterStatus('All')}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  filterStatus === 'All' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('success')}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  filterStatus === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Success
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('failure')}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  filterStatus === 'failure' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Failed
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-700 space-y-2">
          <p className="font-semibold text-slate-800">Why this page exists</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Audit</strong> plan automation: confirm which runs succeeded or failed, and read technical details when something breaks (e.g. API or AI provider).
            </li>
            <li>
              <strong>Transparency</strong>: amounts are in your plan currency ({planCurrency}) and mirror the split the engine used (Core / High-Upside / speculative when present).
            </li>
            <li>
              <strong>Not for</strong>: live dividend cash, cash balances, or broker fills—use <strong>Dividend Tracker</strong>, <strong>Portfolios</strong>, and your broker for those.
            </li>
          </ul>
          {runStats.total > 0 && (
            <p className="text-xs text-slate-600 pt-1 border-t border-slate-200/80 mt-2">
              Logged runs: <span className="tabular-nums font-medium">{runStats.total}</span> ({runStats.success} succeeded, {runStats.failure} failed).
            </p>
          )}
        </div>
      </section>

      <SectionCard title="Runs" className="border-slate-200" collapsible collapsibleSummary="Execution log entries" defaultExpanded>
        <p className="text-sm text-slate-600 mb-4">
          Amounts are in your plan currency ({planCurrency}) from <strong>Investment Plan</strong>. Proposed trades are what the engine generated; placing orders at your broker is separate.
        </p>
        {listBody}
      </SectionCard>
    </div>
  );
};

export default ExecutionHistoryView;
