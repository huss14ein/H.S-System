import React, { useState, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { useStatementProcessing } from '../context/StatementProcessingContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import { DocumentArrowUpIcon, ChatBubbleLeftRightIcon, BanknotesIcon, CheckCircleIcon } from '../components/icons';
import { parseBankStatement, parseSMSTransactions, parseTradingStatement } from '../services/statementParser';
import { Transaction, InvestmentTransaction } from '../types';
import InfoHint from '../components/InfoHint';

const StatementUpload: React.FC = () => {
  const { data, addTransaction, recordTrade } = useContext(DataContext)!;
  const { uploadStatement, processStatement } = useStatementProcessing();
  const [activeTab, setActiveTab] = useState<'bank' | 'sms' | 'trading'>('bank');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [smsText, setSmsText] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [extractedTransactions, setExtractedTransactions] = useState<Transaction[]>([]);
  const [extractedInvestmentTransactions, setExtractedInvestmentTransactions] = useState<InvestmentTransaction[]>([]);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bankAccounts = (data?.accounts ?? []).filter(a => a.type !== 'Investment');
  const investmentAccounts = (data?.accounts ?? []).filter(a => a.type === 'Investment');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setProcessingError(null);
    setIsProcessingFile(true);

    try {
      // Parse based on file type using real parser
      let transactions: Transaction[] = [];
      let investmentTransactions: InvestmentTransaction[] = [];

      if (activeTab === 'trading') {
        const result = await parseTradingStatement(file, selectedAccount);
        investmentTransactions = result.transactions;
        setExtractedInvestmentTransactions(investmentTransactions);
      } else {
        const result = await parseBankStatement(file, selectedAccount);
        transactions = result.transactions;
        setExtractedTransactions(transactions);
      }

      if (transactions.length > 0 || investmentTransactions.length > 0) {
        // Save statement metadata to context for history tracking
        try {
          await uploadStatement(file, {
            bankName: 'Auto-detected',
            accountNumber: selectedAccount || 'Unknown',
            accountType: activeTab === 'trading' ? 'investment' : 'checking'
          });
        } catch (error) {
          console.warn('Failed to save statement metadata:', error);
          // Continue anyway - transactions can still be imported
        }
        
        setIsReviewModalOpen(true);
      } else {
        alert('No transactions found in the uploaded file. Please check the file format.');
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setProcessingError(error instanceof Error ? error.message : 'Failed to process file');
      alert(`Error processing file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleSMSPaste = async () => {
    if (!smsText.trim()) {
      alert('Please paste SMS transaction text');
      return;
    }

    if (!selectedAccount) {
      alert('Please select an account');
      return;
    }

    setProcessingError(null);
    setIsProcessingFile(true);

    try {
      const result = await parseSMSTransactions(smsText, selectedAccount);
      setExtractedTransactions(result.transactions);
      
      if (result.transactions.length > 0) {
        setIsReviewModalOpen(true);
      } else {
        alert('No transactions found in the SMS text. Please check the format.');
      }
    } catch (error) {
      console.error('Error parsing SMS:', error);
      setProcessingError(error instanceof Error ? error.message : 'Failed to parse SMS');
      alert(`Error parsing SMS: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleApproveTransactions = async () => {
    try {
      // Save regular transactions
      for (const tx of extractedTransactions) {
        await addTransaction({
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          category: tx.category,
          accountId: tx.accountId,
          budgetCategory: tx.budgetCategory,
          subcategory: tx.subcategory,
          type: tx.type,
          transactionNature: tx.transactionNature,
          expenseType: tx.expenseType,
          status: tx.status || 'Approved'
        });
      }

      // Save investment transactions using recordTrade
      for (const tx of extractedInvestmentTransactions) {
        await recordTrade({
          accountId: tx.accountId,
          date: tx.date,
          type: tx.type,
          symbol: tx.symbol,
          quantity: tx.quantity,
          price: tx.price,
          total: tx.total,
          currency: tx.currency
        });
      }

      alert(`Successfully imported ${extractedTransactions.length + extractedInvestmentTransactions.length} transactions!`);
      setIsReviewModalOpen(false);
      setExtractedTransactions([]);
      setExtractedInvestmentTransactions([]);
      setSmsText('');
      setUploadedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error saving transactions:', error);
      alert(`Failed to save transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRejectTransaction = (index: number, type: 'transaction' | 'investment') => {
    if (type === 'transaction') {
      setExtractedTransactions(prev => prev.filter((_, i) => i !== index));
    } else {
      setExtractedInvestmentTransactions(prev => prev.filter((_, i) => i !== index));
    }
  };

  return (
    <PageLayout
      title="Upload Statements"
      description="Upload bank statements, paste SMS transactions, or upload trading statements to automatically import transactions"
    >
      <div className="space-y-6">
        {/* Tabs */}
        <div className="bg-white rounded-xl border border-slate-200 p-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('bank')}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'bank'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <BanknotesIcon className="h-5 w-5 inline-block mr-2" />
              Bank Statements
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sms')}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'sms'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ChatBubbleLeftRightIcon className="h-5 w-5 inline-block mr-2" />
              SMS Transactions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trading')}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'trading'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <DocumentArrowUpIcon className="h-5 w-5 inline-block mr-2" />
              Trading Statements
            </button>
          </div>
        </div>

        {/* Bank Statement Upload */}
        {activeTab === 'bank' && (
          <SectionCard
            title="Upload Bank Statement"
            headerAction={
              <InfoHint text="Supported formats: PDF, CSV, Excel. The system will extract transactions automatically using AI." />
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Account
                </label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="">Select an account...</option>
                  {bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Upload Statement File
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.xlsx,.xls,.ofx,.qfx"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="bank-statement-upload"
                  />
                  <label
                    htmlFor="bank-statement-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <DocumentArrowUpIcon className="h-12 w-12 text-slate-400 mb-4" />
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF, CSV, Excel, OFX, QFX (Max 10MB)
                    </p>
                  </label>
                </div>
                {uploadedFile && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                    <span>{uploadedFile.name}</span>
                  </div>
                )}
              </div>

              {processingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{processingError}</p>
                </div>
              )}

              {isProcessingFile && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm text-blue-700">Processing statement...</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* SMS Transaction Paste */}
        {activeTab === 'sms' && (
          <SectionCard
            title="Paste SMS Transactions"
            headerAction={
              <InfoHint text="Paste SMS transaction messages from your bank. The system will extract date, amount, description, and merchant automatically." />
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Account
                </label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="">Select an account...</option>
                  {bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Paste SMS Text
                </label>
                <textarea
                  value={smsText}
                  onChange={(e) => setSmsText(e.target.value)}
                  placeholder="Paste SMS messages here, one per line or separated by newlines. Example:&#10;Al Rajhi: SAR 500.00 debited from A/C *1234 on 15/01/2024. Bal: SAR 5,000.00&#10;STC: Payment of SAR 100.00 received on 16/01/2024"
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary h-48 font-mono text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  You can paste multiple SMS messages. The system will extract all transactions automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSMSPaste}
                disabled={!smsText.trim() || !selectedAccount || isProcessingFile}
                className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isProcessingFile ? 'Processing...' : 'Extract Transactions'}
              </button>

              {processingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{processingError}</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Trading Statement Upload */}
        {activeTab === 'trading' && (
          <SectionCard
            title="Upload Trading Statement"
            headerAction={
              <InfoHint text="Upload trading statements from brokers (PDF, CSV, Excel). The system will extract buy/sell transactions, dividends, and fees automatically." />
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Investment Account
                </label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="">Select an investment account...</option>
                  {investmentAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Upload Trading Statement
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="trading-statement-upload"
                  />
                  <label
                    htmlFor="trading-statement-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <DocumentArrowUpIcon className="h-12 w-12 text-slate-400 mb-4" />
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF, CSV, Excel (Max 10MB)
                    </p>
                  </label>
                </div>
                {uploadedFile && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                    <span>{uploadedFile.name}</span>
                  </div>
                )}
              </div>

              {processingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{processingError}</p>
                </div>
              )}

              {isProcessingFile && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm text-blue-700">Processing trading statement...</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Review Modal */}
        <Modal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          title="Review Extracted Transactions"
          maxWidthClass="max-w-4xl"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Review the extracted transactions before importing. You can remove any transactions you don't want to import.
            </p>

            {/* Regular Transactions */}
            {extractedTransactions.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3">
                  Bank Transactions ({extractedTransactions.length})
                </h3>
                <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Category</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {extractedTransactions.map((tx, index) => (
                        <tr key={index}>
                          <td className="px-4 py-3 text-sm text-slate-900">{new Date(tx.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{tx.description}</td>
                          <td className={`px-4 py-3 text-sm text-right font-medium ${tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{tx.category || 'Uncategorized'}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRejectTransaction(index, 'transaction')}
                              className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Investment Transactions */}
            {extractedInvestmentTransactions.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3">
                  Investment Transactions ({extractedInvestmentTransactions.length})
                </h3>
                <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {extractedInvestmentTransactions.map((tx, index) => (
                        <tr key={index}>
                          <td className="px-4 py-3 text-sm text-slate-900">{new Date(tx.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              tx.type === 'buy' ? 'bg-emerald-100 text-emerald-800' :
                              tx.type === 'sell' ? 'bg-rose-100 text-rose-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {tx.type.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{tx.symbol}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900">{tx.quantity}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900">{tx.price.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-slate-900">
                            {tx.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tx.currency || 'SAR'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRejectTransaction(index, 'investment')}
                              className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveTransactions}
                disabled={extractedTransactions.length === 0 && extractedInvestmentTransactions.length === 0}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {extractedTransactions.length + extractedInvestmentTransactions.length} Transaction(s)
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </PageLayout>
  );
};

export default StatementUpload;
