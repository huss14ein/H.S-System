import React, { useMemo, useContext, useState } from 'react';
import { DataContext } from '../context/DataContext';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ClockIcon } from '../components/icons/ClockIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

const ExecutionHistoryView: React.FC = () => {
  const { data } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const [filterStatus, setFilterStatus] = useState<'All' | 'success' | 'failure'>('All');
  
  const executionLogs = useMemo(() => {
    // Get execution logs from data context
    // Note: This assumes execution logs are stored in data.executionLogs
    // If stored differently, adjust accordingly
    const logs = (data as any)?.executionLogs ?? [];
    return logs
      .filter((log: any) => filterStatus === 'All' || log.status === filterStatus)
      .sort((a: any, b: any) => {
        const dateA = new Date(a.created_at || a.date || 0).getTime();
        const dateB = new Date(b.created_at || b.date || 0).getTime();
        return dateB - dateA; // Most recent first
      });
  }, [data, filterStatus]);

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
            <p className="text-slate-500">Execute an investment plan to see history here</p>
          </div>
        ) : (
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
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default ExecutionHistoryView;
