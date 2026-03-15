import React, { useMemo, useContext, useState } from 'react';
import { DataContext } from '../context/DataContext';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ClockIcon } from '../components/icons/ClockIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

const ExecutionHistoryView: React.FC = () => {
  const { data, loading } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const [filterStatus, setFilterStatus] = useState<'All' | 'success' | 'failure'>('All');

  const executionLogs = useMemo(() => {
    // Get execution logs from data context (loaded from database)
    let logs: any[] = [];
    
    // Primary source: data.executionLogs from database
    if (data?.executionLogs && Array.isArray(data.executionLogs)) {
      logs = [...data.executionLogs];
    }
    
    // Fallback: Check localStorage for any locally stored logs
    const storageKeys = [
      'investment-execution-logs',
      'investmentPlanExecutionLogs',
      'execution-logs',
    ];
    
    for (const key of storageKeys) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            logs = [...logs, ...parsed];
          } else if (parsed && typeof parsed === 'object') {
            logs = [...logs, ...(parsed.logs || [parsed])];
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    // Remove duplicates by id or unique combination
    const uniqueLogs = Array.from(
      new Map(
        logs.map((log: any) => [
          log.id || `${log.date || log.created_at || log.timestamp}-${log.totalInvestment || 0}`,
          log
        ])
      ).values()
    );
    
    return uniqueLogs
      .filter((log: any) => {
        if (filterStatus === 'All') return true;
        const status = log.status || log.executionStatus || 'unknown';
        return status.toLowerCase() === filterStatus.toLowerCase();
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.created_at || a.date || a.timestamp || 0).getTime();
        const dateB = new Date(b.created_at || b.date || b.timestamp || 0).getTime();
        return dateB - dateA; // Most recent first
      });
  }, [data?.executionLogs, filterStatus]);

  if (loading || !data) {
    return (
      <div className="space-y-6" aria-busy="true">
        <SectionCard title="Execution History">
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-label="Loading execution history" />
            <span className="text-sm text-slate-600">Loading execution history…</span>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Execution History">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <ClockIcon className="h-7 w-7 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Execution History</h2>
                <p className="text-slate-600 mt-1">View past investment plan executions and their results</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilterStatus('All')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'All'
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('success')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'success'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Success
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('failure')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'failure'
                    ? 'bg-rose-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Failed
              </button>
            </div>
          </div>
        </div>

        {executionLogs.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full mx-auto mb-6 flex items-center justify-center">
              <ClockIcon className="h-10 w-10 text-slate-400" />
            </div>
            <p className="text-xl font-semibold text-slate-600 mb-2">No execution history yet</p>
            <p className="text-slate-500 mb-4">Execute an investment plan to see history here</p>
            <button
              type="button"
              onClick={() => {
                // Navigate to Investment Plan tab if available
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
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const csv = [
                    ['Date', 'Status', 'Total Investment', 'Core', 'High-Upside', 'Speculative', 'Trades Count'].join(','),
                    ...executionLogs.map((log: any) => {
                      const date = log.created_at || log.date || log.timestamp;
                      const dateStr = date ? new Date(date).toISOString().split('T')[0] : '';
                      return [
                        dateStr,
                        log.status || 'unknown',
                        log.totalInvestment ?? 0,
                        log.coreInvestment ?? 0,
                        log.upsideInvestment ?? 0,
                        log.speculativeInvestment ?? 0,
                        Array.isArray(log.trades) ? log.trades.length : 0
                      ].join(',');
                    })
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
                Export All to CSV
              </button>
            </div>
          <div className="space-y-4">
            {executionLogs.map((log: any, index: number) => {
              const executionDate = log.created_at || log.date;
              const dateObj = executionDate ? new Date(executionDate) : new Date();
              
              return (
                <div
                  key={log.id || index}
                  className={`rounded-2xl border-2 p-6 shadow-lg hover:shadow-xl transition-all duration-300 ${
                    log.status === 'success'
                      ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50'
                      : 'border-rose-200 bg-gradient-to-br from-rose-50 to-red-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        log.status === 'success'
                          ? 'bg-emerald-100'
                          : 'bg-rose-100'
                      }`}>
                        {log.status === 'success' ? (
                          <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
                        ) : (
                          <ExclamationTriangleIcon className="h-6 w-6 text-rose-600" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">
                          Execution {log.status === 'success' ? 'Successful' : 'Failed'}
                        </h3>
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
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      log.status === 'success'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}>
                      {log.status?.toUpperCase() || 'UNKNOWN'}
                    </span>
                  </div>

                  {log.log_details && (
                    <div className="mt-4 p-4 bg-white/70 backdrop-blur-sm rounded-xl border border-slate-200">
                      <p className="text-sm font-semibold text-slate-700 mb-2">Execution Details</p>
                      <div className="prose prose-sm max-w-none text-slate-600">
                        <SafeMarkdownRenderer content={log.log_details} />
                      </div>
                    </div>
                  )}

                  {log.totalInvestment != null && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Investment</p>
                        <p className="text-lg font-bold text-slate-900">{formatCurrencyString(log.totalInvestment ?? 0, { digits: 0 })}</p>
                      </div>
                      {log.coreInvestment != null && (
                        <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Core</p>
                          <p className="text-lg font-bold text-slate-900">{formatCurrencyString(log.coreInvestment ?? 0, { digits: 0 })}</p>
                        </div>
                      )}
                      {log.upsideInvestment != null && (
                        <div className="bg-white/70 backdrop-blur-sm rounded-lg p-3 border border-slate-200">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">High-Upside</p>
                          <p className="text-lg font-bold text-slate-900">{formatCurrencyString(log.upsideInvestment ?? 0, { digits: 0 })}</p>
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
                      <p className="text-sm font-semibold text-slate-700 mb-2">Proposed Trades ({log.trades.length})</p>
                      <div className="space-y-1">
                        {log.trades.slice(0, 5).map((trade: any, idx: number) => (
                          <div key={idx} className="text-xs text-slate-600 bg-slate-50 rounded p-2">
                            <span className="font-semibold">{trade.ticker}</span>: {formatCurrencyString(trade.amount ?? 0, { digits: 0 })} - {trade.reason || 'N/A'}
                          </div>
                        ))}
                        {log.trades.length > 5 && (
                          <p className="text-xs text-slate-500 italic">+ {log.trades.length - 5} more trades</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
        )}
      </SectionCard>
    </div>
  );
};

export default ExecutionHistoryView;
