import React, { useState, useMemo } from 'react';
import { useStatementProcessing } from '../context/StatementProcessingContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import { MagnifyingGlassIcon } from '../components/icons';
import { ArrowDownTrayIcon } from '../components/icons/ArrowDownTrayIcon';
import { StatementIcons, getStatementIcon } from '../constants/statementIcons';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { Page } from '../types';

interface StatementHistoryViewProps {
  setActivePage?: (page: Page) => void;
}

const StatementHistoryView: React.FC<StatementHistoryViewProps> = ({ setActivePage }) => {
  const { statements, getStatementById, deleteStatement, exportTransactions, reconcileTransactions } = useStatementProcessing();
  const { formatCurrencyString } = useFormatCurrency();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed' | 'reviewing'>('all');
  const [isReconciliationModalOpen, setIsReconciliationModalOpen] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState<any>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  const filteredStatements = useMemo(() => {
    let filtered = [...statements];

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(s => s.status === statusFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.fileName.toLowerCase().includes(query) ||
        s.bankName?.toLowerCase().includes(query) ||
        s.accountNumber?.toLowerCase().includes(query)
      );
    }

    return filtered.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }, [statements, statusFilter, searchQuery]);

  const handleReconcile = async (statementId: string) => {
    setIsReconciling(true);
    try {
      const result = await reconcileTransactions(statementId);
      setReconciliationResult(result);
      setIsReconciliationModalOpen(true);
    } catch (error) {
      alert(`Reconciliation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleExportStatement = (statementId: string) => {
    const csv = exportTransactions(statementId);
    if (!csv) {
      alert('No transactions to export');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const statement = getStatementById(statementId);
    a.download = `statement-${statement?.fileName || statementId}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalStatements = statements.length;
  const completedStatements = statements.filter(s => s.status === 'completed').length;
  const failedStatements = statements.filter(s => s.status === 'failed').length;
  const totalTransactionsExtracted = statements.reduce((sum, s) => sum + (s.transactions?.length || 0), 0);

  return (
    <PageLayout
      title="Statement History"
      description="View and manage all uploaded statements, reconcile transactions, and track import history"
      action={
        setActivePage && (
          <button
            type="button"
            onClick={() => setActivePage('Statement Upload')}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <StatementIcons.upload className="h-5 w-5" />
            Upload New Statement
          </button>
        )
      }
    >
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Total Statements</p>
            <p className="text-2xl font-bold text-blue-900">{totalStatements}</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Completed</p>
            <p className="text-2xl font-bold text-emerald-900">{completedStatements}</p>
          </div>
          <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-xl p-4 border border-rose-200">
            <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-1">Failed</p>
            <p className="text-2xl font-bold text-rose-900">{failedStatements}</p>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
            <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">Transactions Extracted</p>
            <p className="text-2xl font-bold text-purple-900">{totalTransactionsExtracted}</p>
          </div>
        </div>

        {/* Filters */}
        <SectionCard title="Statement History">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by file name, bank, account..."
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="reviewing">Reviewing</option>
            </select>
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Clear Filters
            </button>
          </div>

          {filteredStatements.length === 0 ? (
            <div className="text-center py-12">
              <StatementIcons.upload className="h-12 w-12 text-slate-300 mx-auto mb-4" aria-hidden />
              <p className="text-lg font-semibold text-slate-600 mb-2">No statements found</p>
              <p className="text-sm text-slate-500 mb-4">
                {statements.length === 0
                  ? 'Upload your first statement to get started'
                  : 'Try adjusting your search or filter criteria'}
              </p>
              {statements.length === 0 && setActivePage && (
                <button
                  type="button"
                  onClick={() => setActivePage('Statement Upload')}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium inline-flex items-center gap-2"
                >
                  <StatementIcons.upload className="h-4 w-4" />
                  Upload statement
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredStatements.map((statement) => (
                <div
                  key={statement.id}
                  className="border-2 rounded-xl p-5 bg-white hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {(() => {
                          const StatementTypeIcon = getStatementIcon(statement.bankName, statement.accountType);
                          return <StatementTypeIcon className="h-5 w-5 text-slate-500 flex-shrink-0" aria-hidden />;
                        })()}
                        <h3 className="text-lg font-bold text-slate-900">{statement.fileName}</h3>
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            statement.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : statement.status === 'failed'
                              ? 'bg-rose-100 text-rose-800'
                              : statement.status === 'reviewing'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {statement.status.toUpperCase()}
                        </span>
                        {statement.confidence > 0 && (
                          <span className="text-xs text-slate-500">
                            Confidence: {(statement.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 mt-2">
                        {statement.bankName && <span>Bank: {statement.bankName}</span>}
                        {statement.accountNumber && <span>Account: {statement.accountNumber}</span>}
                        <span>
                          Uploaded: {statement.uploadedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                        {statement.processedAt && (
                          <span>
                            Processed: {statement.processedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                        )}
                            <span>Transactions: {statement.transactions?.length || 0}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportStatement(statement.id)}
                        className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                        title="Export transactions"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4 inline mr-1" />
                        Export
                      </button>
                      {statement.status === 'completed' && (statement.transactions?.length || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => handleReconcile(statement.id)}
                          disabled={isReconciling}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"
                          title="Reconcile with existing transactions"
                        >
                          {isReconciling ? 'Reconciling...' : 'Reconcile'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Delete this statement? This will not delete imported transactions.')) {
                            deleteStatement(statement.id);
                          }
                        }}
                        className="px-3 py-1.5 text-sm font-medium text-rose-700 bg-rose-50 rounded-lg hover:bg-rose-100 transition-colors"
                        title="Delete statement"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {statement.summary && statement.summary.transactionCount > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-200">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Total Credits</p>
                        <p className="text-lg font-bold text-emerald-700">
                          {formatCurrencyString(statement.summary.totalCredits, { digits: 0 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Total Debits</p>
                        <p className="text-lg font-bold text-rose-700">
                          {formatCurrencyString(statement.summary.totalDebits, { digits: 0 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Net Change</p>
                        <p className={`text-lg font-bold ${statement.summary.netChange >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {statement.summary.netChange >= 0 ? '+' : ''}
                          {formatCurrencyString(statement.summary.netChange, { digits: 0 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Transaction Count</p>
                        <p className="text-lg font-bold text-slate-900">{statement.summary.transactionCount}</p>
                      </div>
                    </div>
                  )}

                  {statement.errors && statement.errors.length > 0 && (
                    <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg">
                      <p className="text-sm font-semibold text-rose-800 mb-2">Errors:</p>
                      <ul className="list-disc list-inside text-sm text-rose-700 space-y-1">
                        {statement.errors.map((error, idx) => (
                          <li key={idx}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(statement.transactions?.length || 0) > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                          <p className="text-sm font-semibold text-slate-700 mb-2">
                            Extracted Transactions ({statement.transactions?.length || 0})
                          </p>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {(statement.transactions || []).slice(0, 10).map((tx, idx) => (
                              <div
                                key={idx}
                                className="text-xs p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between"
                              >
                                <div>
                                  <span className="font-semibold">{tx.description}</span>
                                  <span className="text-slate-500 ml-2">
                                    {tx.date instanceof Date ? tx.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                </div>
                                <span className={`font-bold ${tx.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  {tx.amount >= 0 ? '+' : ''}
                                  {formatCurrencyString(tx.amount, { digits: 2 })}
                                </span>
                              </div>
                            ))}
                            {(statement.transactions?.length || 0) > 10 && (
                              <p className="text-xs text-slate-500 italic text-center pt-2">
                                + {(statement.transactions?.length || 0) - 10} more transactions
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Reconciliation Modal */}
        <Modal
          isOpen={isReconciliationModalOpen}
              onClose={() => {
                setIsReconciliationModalOpen(false);
                setReconciliationResult(null);
              }}
          title="Reconciliation Results"
          maxWidthClass="max-w-2xl"
        >
          {reconciliationResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Total Transactions</p>
                  <p className="text-2xl font-bold text-slate-900">{reconciliationResult.totalTransactions}</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs font-semibold text-emerald-700 uppercase mb-1">Matched</p>
                  <p className="text-2xl font-bold text-emerald-900">{reconciliationResult.matchedTransactions}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg">
                  <p className="text-xs font-semibold text-amber-700 uppercase mb-1">Unmatched</p>
                  <p className="text-2xl font-bold text-amber-900">{reconciliationResult.unmatchedTransactions}</p>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg">
                  <p className="text-xs font-semibold text-rose-700 uppercase mb-1">Duplicates</p>
                  <p className="text-2xl font-bold text-rose-900">{reconciliationResult.duplicateTransactions}</p>
                </div>
              </div>

              {reconciliationResult.confidence !== undefined && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs font-semibold text-blue-700 uppercase mb-1">Reconciliation Confidence</p>
                  <p className="text-2xl font-bold text-blue-900">{reconciliationResult.confidence.toFixed(1)}%</p>
                </div>
              )}

              {reconciliationResult.discrepancies && reconciliationResult.discrepancies.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">Discrepancies Found:</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {reconciliationResult.discrepancies.map((disc: any, idx: number) => (
                      <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm font-medium text-amber-900">{disc.type.replace('_', ' ').toUpperCase()}</p>
                        <p className="text-xs text-amber-700 mt-1">{disc.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                      onClick={() => {
                        setIsReconciliationModalOpen(false);
                        setReconciliationResult(null);
                      }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </PageLayout>
  );
};

export default StatementHistoryView;
