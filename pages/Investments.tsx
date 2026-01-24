
import React, { useMemo, useState, useCallback, useRef, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import Card from '../components/Card';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { getInvestmentAIAnalysis, getPlatformPerformanceAnalysis, getAIStrategy, getAIResearchNews, getAIStockAnalysis } from '../services/geminiService';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { InvestmentPortfolio, Holding, InvestmentTransaction, Account } from '../types';
import Modal from '../components/Modal';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { LinkIcon } from '../components/icons/LinkIcon';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { ChartPieIcon } from '../components/icons/ChartPieIcon';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { AcademicCapIcon } from '../components/icons/AcademicCapIcon';
import { MegaphoneIcon } from '../components/icons/MegaphoneIcon';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { PresentationChartLineIcon } from '../components/icons/PresentationChartLineIcon';
import { Squares2X2Icon } from '../components/icons/Squares2X2Icon';
import { EyeIcon } from '../components/icons/EyeIcon';
import AIRebalancerView from './AIRebalancerView';
import PortfolioPerformanceChart from '../components/charts/PortfolioPerformanceChart';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import WatchlistView from './WatchlistView';
import TradeAdvicesView from './TradeAdvicesView';
import { BookOpenIcon } from '../components/icons/BookOpenIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import MiniPriceChart from '../components/charts/MiniPriceChart';
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon';

type InvestmentSubPage = 'Portfolio' | 'Platform' | 'Watchlist' | 'AI Rebalancer' | 'Trade Advices';

const INVESTMENT_SUB_PAGES: { name: InvestmentSubPage; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { name: 'Portfolio', icon: PresentationChartLineIcon },
    { name: 'Platform', icon: Squares2X2Icon },
    { name: 'AI Rebalancer', icon: ScaleIcon },
    { name: 'Watchlist', icon: EyeIcon },
    { name: 'Trade Advices', icon: BookOpenIcon },
];

const RecordTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (trade: Omit<InvestmentTransaction, 'id' | 'total'>) => void;
    investmentAccounts: Account[];
}> = ({ isOpen, onClose, onSave, investmentAccounts }) => {
    const [accountId, setAccountId] = useState(investmentAccounts[0]?.id || '');
    const [type, setType] = useState<'buy' | 'sell'>('buy');
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            accountId,
            type,
            symbol: symbol.toUpperCase().trim(),
            quantity: parseFloat(quantity) || 0,
            price: parseFloat(price) || 0,
            date,
        });
        setSymbol('');
        setQuantity('');
        setPrice('');
        onClose();
    };
    
    useEffect(() => {
        if (isOpen && investmentAccounts.length > 0) {
            setAccountId(investmentAccounts[0].id);
            setType('buy');
            setSymbol('');
            setQuantity('');
            setPrice('');
            setDate(new Date().toISOString().split('T')[0]);
        }
    }, [isOpen, investmentAccounts]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record a Trade">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="account-id" className="block text-sm font-medium text-gray-700">Platform / Account</label>
                    <select id="account-id" value={accountId} onChange={e => setAccountId(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                </div>
                <div className="flex space-x-4">
                    <label className="flex items-center"><input type="radio" value="buy" checked={type === 'buy'} onChange={() => setType('buy')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Buy</span></label>
                    <label className="flex items-center"><input type="radio" value="sell" checked={type === 'sell'} onChange={() => setType('sell')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Sell</span></label>
                </div>
                 <div>
                    <label htmlFor="symbol" className="block text-sm font-medium text-gray-700">Symbol</label>
                    <input type="text" id="symbol" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">Quantity</label>
                        <input type="number" id="quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                     <div>
                        <label htmlFor="price" className="block text-sm font-medium text-gray-700">Price per Share</label>
                        <input type="number" id="price" value={price} onChange={e => setPrice(e.target.value)} required min="0" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                </div>
                <div>
                    <label htmlFor="date" className="block text-sm font-medium text-gray-700">Transaction Date</label>
                    <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Record Trade</button>
            </form>
        </Modal>
    );
};

// #region Portfolio View Components
const HoldingDetailModal: React.FC<{ isOpen: boolean, onClose: () => void, holding: (Holding & { gainLoss: number, gainLossPercent: number }) | null }> = ({ isOpen, onClose, holding }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleGetAIAnalysis = useCallback(async () => {
        if (!holding) return;
        setIsLoading(true);
        const analysis = await getAIStockAnalysis(holding);
        setAiAnalysis(analysis);
        setIsLoading(false);
    }, [holding]);

    if (!holding) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for ${holding.name} (${holding.symbol})`}>
            <div className="space-y-4">
                <MiniPriceChart />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-center">
                    <div><dt className="text-gray-500">Market Value</dt><dd className="font-semibold text-dark text-base">{formatCurrencyString(holding.currentValue)}</dd></div>
                    <div><dt className="text-gray-500">Quantity</dt><dd className="font-semibold text-dark text-base">{holding.quantity}</dd></div>
                    <div><dt className="text-gray-500">Avg. Cost</dt><dd className="font-semibold text-dark text-base">{formatCurrencyString(holding.avgCost)}</dd></div>
                    <div><dt className="text-gray-500">Unrealized G/L</dt><dd className="font-semibold text-base">{formatCurrency(holding.gainLoss, { colorize: true })}</dd></div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-gray-800">Fictional AI Analyst Report</h4>
                        <button onClick={handleGetAIAnalysis} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                            <SparklesIcon className="h-4 w-4 mr-2" />
                            {isLoading ? 'Generating...' : 'Generate Report'}
                        </button>
                    </div>
                    {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating fictional analysis...</div>}
                    {aiAnalysis && !isLoading && (
                        <div className="mt-2 prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: aiAnalysis.replace(/### (.*)/g, '<h3 class="font-semibold text-base mt-3 mb-1">$1</h3>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }} />
                    )}
                </div>
            </div>
        </Modal>
    )
}

const AddPortfolioModal: React.FC<{ isOpen: boolean, onClose: () => void, onAdd: (name: string, accountId: string) => void, investmentAccounts: Account[] }> = ({ isOpen, onClose, onAdd, investmentAccounts }) => {
    const [name, setName] = useState('');
    const [accountId, setAccountId] = useState(investmentAccounts[0]?.id || '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name && accountId) {
            onAdd(name, accountId);
            setName('');
            onClose();
        }
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Portfolio">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="portfolio-name" className="block text-sm font-medium text-gray-700">Portfolio Name</label>
                    <input type="text" id="portfolio-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary"/>
                </div>
                <div>
                    <label htmlFor="account-id" className="block text-sm font-medium text-gray-700">Investment Account</label>
                    <select id="account-id" value={accountId} onChange={e => setAccountId(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Add Portfolio</button>
            </form>
        </Modal>
    )
}

const PortfolioView: React.FC<{ portfolio: InvestmentPortfolio, onHoldingClick: (holding: any) => void }> = ({ portfolio, onHoldingClick }) => {
  const { formatCurrency, formatCurrencyString } = useFormatCurrency();
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof ReturnType<typeof useMemo_holdingsWithGains>[0] | null, direction: 'asc' | 'desc' }>({ key: 'currentValue', direction: 'desc' });

  const investmentSummary = useMemo(() => {
    const totalValue = portfolio.holdings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalCost = portfolio.holdings.reduce((sum, h) => sum + (h.avgCost * h.quantity), 0);
    const totalGainLoss = totalValue - totalCost;
    const performance = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
    return { totalValue, totalGainLoss, performance };
  }, [portfolio]);

  const handleGetAIInsight = useCallback(async () => {
    setIsLoading(true);
    const insight = await getInvestmentAIAnalysis(portfolio.holdings);
    setAiInsight(insight);
    setIsLoading(false);
  }, [portfolio.holdings]);

  const useMemo_holdingsWithGains = useMemo(() => {
    let sortableItems = portfolio.holdings.map(h => {
      const totalCost = h.avgCost * h.quantity;
      const gainLoss = h.currentValue - totalCost;
      const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
      return { ...h, totalCost, gainLoss, gainLossPercent };
    });

    if (sortConfig.key) {
        sortableItems.sort((a, b) => {
            if (a[sortConfig.key!] < b[sortConfig.key!]) return sortConfig.direction === 'asc' ? -1 : 1;
            if (a[sortConfig.key!] > b[sortConfig.key!]) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }
    return sortableItems;
  }, [portfolio.holdings, sortConfig]);

  const requestSort = (key: keyof ReturnType<typeof useMemo_holdingsWithGains>[0]) => {
      let direction: 'asc' | 'desc' = 'desc';
      if (sortConfig.key === key && sortConfig.direction === 'desc') {
          direction = 'asc';
      }
      setSortConfig({ key, direction });
  };
  
  const getSortIndicator = (key: string) => {
      if (sortConfig.key !== key) return null;
      return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
  }


  return (
    <div className="space-y-6 mt-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card title="Total Portfolio Value" value={formatCurrencyString(investmentSummary.totalValue)} />
        <Card title="Total Gain / Loss" value={formatCurrency(investmentSummary.totalGainLoss, { colorize: true })} />
        <Card title="Performance" value={`${investmentSummary.performance.toFixed(2)}%`} trend={`${investmentSummary.performance >= 0 ? '+' : ''}${investmentSummary.performance.toFixed(2)}%`} />
      </div>

      {/* Performance Chart */}
      <PortfolioPerformanceChart initialValue={investmentSummary.totalValue} />

      {/* AI Analysis Section */}
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <LightBulbIcon className="h-6 w-6 text-yellow-500" />
            <h2 className="text-xl font-semibold text-dark">AI Investment Analyst</h2>
          </div>
          <button onClick={handleGetAIInsight} disabled={isLoading} className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
            <SparklesIcon className="h-5 w-5 mr-2" />
            {isLoading ? 'Analyzing...' : 'Get AI Analysis'}
          </button>
        </div>
        {isLoading && <div className="text-center p-4">Analyzing your portfolio...</div>}
        {aiInsight && !isLoading && (
          <div className="prose prose-sm max-w-none text-gray-600 bg-indigo-50 border-l-4 border-indigo-400 p-4 rounded">
            {aiInsight.split('\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
        )}
        {!aiInsight && !isLoading && (
          <div className="text-gray-500 flex items-center space-x-2">
            <InformationCircleIcon className="h-5 w-5" />
            <span>Click "Get AI Analysis" for educational insights on your portfolio.</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Holdings Table */}
        <div className="lg:col-span-3 bg-white shadow rounded-lg overflow-x-auto">
          <h3 className="text-lg font-semibold p-4 border-b">Portfolio Holdings</h3>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => requestSort('symbol')}>Asset{getSortIndicator('symbol')}</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => requestSort('currentValue')}>Market Value{getSortIndicator('currentValue')}</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => requestSort('gainLoss')}>Unrealized G/L{getSortIndicator('gainLoss')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {useMemo_holdingsWithGains.map(h => (
                <tr key={h.symbol} className="hover:bg-gray-50 cursor-pointer" onClick={() => onHoldingClick(h)}>
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    <div>{h.symbol}</div>
                    <div className="text-xs text-gray-500">{h.name}</div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">{formatCurrencyString(h.currentValue)}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-medium">
                    <div>{formatCurrency(h.gainLoss, { colorize: true })}</div>
                    <div className={`text-xs ${h.gainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>({h.gainLossPercent.toFixed(2)}%)</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Allocation Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Portfolio Allocation</h3>
          <div className="h-80">
            <AllocationPieChart data={portfolio.holdings.map(h => ({ name: h.symbol, value: h.currentValue }))} />
          </div>
        </div>
      </div>
    </div>
  );
};
// #endregion

// #region Platform View Components

const TransactionHistoryModal: React.FC<{ isOpen: boolean, onClose: () => void, transactions: InvestmentTransaction[], platformName: string }> = ({ isOpen, onClose, transactions, platformName }) => {
    const { formatCurrency } = useFormatCurrency();
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Transaction History: ${platformName}`}>
            <div className="max-h-[60vh] overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map(t => (
                            <tr key={t.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium ${t.type === 'buy' ? 'text-green-600' : 'text-red-600'}`}>{t.type.toUpperCase()}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm font-semibold text-dark">{t.symbol}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-gray-500">{t.quantity}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-gray-500">{formatCurrency(t.price, {colorize: false})}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-right font-bold text-dark">{formatCurrency(t.total, { colorize: false })}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Modal>
    )
}

const PlatformCard: React.FC<{ 
    platform: Account;
    holdings: Holding[]; 
    transactions: InvestmentTransaction[];
    onEdit: (platform: Account) => void;
    onDelete: (platform: Account) => void;
}> = ({ platform, holdings, transactions, onEdit, onDelete }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const [isTxnModalOpen, setIsTxnModalOpen] = useState(false);
    const [expandedHolding, setExpandedHolding] = useState<string | null>(null);
    const { data, updateHolding } = useContext(DataContext)!;

    const { totalValue, totalInvested, totalWithdrawn, netCapital, totalGainLoss, roi, annualizedReturn } = useMemo(() => {
        const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
        const totalInvested = transactions.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
        const totalWithdrawn = Math.abs(transactions.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
        const netCapital = totalInvested - totalWithdrawn;
        const totalGainLoss = totalValue - netCapital;
        const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
        let annualizedReturn = 0;
        if (transactions.length > 0 && netCapital > 0) {
            const firstTransactionDate = new Date(Math.min(...transactions.map(t => new Date(t.date).getTime())));
            const yearsHeld = (new Date().getTime() - firstTransactionDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
            if (yearsHeld > 0) annualizedReturn = (Math.pow(1 + (totalGainLoss / netCapital), 1 / yearsHeld) - 1) * 100;
        }
        return { totalValue, totalInvested, totalWithdrawn, netCapital, totalGainLoss, roi, annualizedReturn };
    }, [holdings, transactions]);

    const holdingsWithGains = useMemo(() => {
        return holdings.map(h => {
            const totalCost = h.avgCost * h.quantity;
            const gainLoss = h.currentValue - totalCost;
            return { ...h, totalCost, gainLoss };
        }).sort((a,b) => b.currentValue - a.currentValue);
    }, [holdings]);

    return (
        <div className="bg-white p-6 rounded-lg shadow flex flex-col hover:shadow-xl transition-shadow duration-300 ease-in-out">
            <div className="border-b pb-4 mb-4">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center space-x-2">
                           <h3 className="text-xl font-semibold text-dark">{platform.name}</h3>
                           <button onClick={() => onEdit(platform)} className="text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4" /></button>
                           <button onClick={() => onDelete(platform)} className="text-gray-400 hover:text-red-500"><TrashIcon className="h-4 w-4" /></button>
                        </div>
                        <p className="text-2xl font-bold text-secondary">{formatCurrencyString(totalValue)}</p>
                    </div>
                    <button onClick={() => setIsTxnModalOpen(true)} className="flex items-center text-sm text-primary hover:underline">
                        <ArrowsRightLeftIcon className="h-4 w-4 mr-1"/>
                        Transaction Log
                    </button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-x-2 text-center pt-3 border-t">
                    <div>
                        <dt className="text-xs text-gray-500">Total Gain/Loss</dt>
                        <dd className={`font-semibold ${totalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrencyString(totalGainLoss, { digits: 0 })}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-gray-500">Total ROI</dt>
                        <dd className={`font-semibold ${roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>{roi.toFixed(2)}%</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-gray-500">Annualized Return</dt>
                        <dd className={`font-semibold ${annualizedReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>{annualizedReturn.toFixed(2)}%</dd>
                    </div>
                </div>
            </div>
            
             <div className="space-y-2">
                <h4 className="font-semibold text-gray-700">Holdings</h4>
                 <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                    {holdingsWithGains.map(h => {
                        const isExpanded = expandedHolding === h.symbol;
                        return (
                             <div key={h.symbol} className="rounded-md hover:bg-gray-50 border">
                                <div className="flex items-center text-sm p-2 cursor-pointer" onClick={() => setExpandedHolding(isExpanded ? null : h.symbol)}>
                                    <div className="w-2/5">
                                        <div className="font-medium text-gray-900">{h.symbol}</div>
                                        <div className="text-xs text-gray-500 truncate" title={h.name}>{h.name}</div>
                                    </div>
                                    <div className="w-1/5 text-right font-semibold text-dark">{formatCurrencyString(h.currentValue, { digits: 0 })}</div>
                                    <div className="w-1/5 text-right font-medium text-xs">{formatCurrency(h.gainLoss, { colorize: true, digits: 0 })}</div>
                                    <div className="w-1/5 flex justify-end items-center">
                                       <ChevronDownIcon className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'transform rotate-180' : ''}`} />
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="bg-gray-50 p-3 border-t text-xs">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div><dt className="text-gray-500">Quantity</dt><dd className="font-medium text-dark">{h.quantity.toLocaleString()}</dd></div>
                                            <div><dt className="text-gray-500">Avg Cost</dt><dd className="font-medium text-dark">{formatCurrencyString(h.avgCost, {digits:2})}</dd></div>
                                            <div><dt className="text-gray-500">Total Cost</dt><dd className="font-medium text-dark">{formatCurrencyString(h.totalCost, {digits:0})}</dd></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                 </div>
             </div>
            
            <TransactionHistoryModal isOpen={isTxnModalOpen} onClose={() => setIsTxnModalOpen(false)} transactions={transactions} platformName={platform.name} />
        </div>
    );
};


const PlatformView: React.FC<{onAddPlatform: () => void, onEditPlatform: (platform: Account) => void, onDeletePlatform: (platform: Account) => void}> = ({onAddPlatform, onEditPlatform, onDeletePlatform}) => {
    const { data } = useContext(DataContext)!;

    const platforms = useMemo(() => {
        const investmentAccounts = data.accounts
            .filter(acc => acc.type === 'Investment')
            .sort((a,b) => a.name.localeCompare(b.name));
        
        return investmentAccounts.map(account => {
            const portfoliosInAccount = data.investments.filter(p => p.accountId === account.id);
            const allHoldings = portfoliosInAccount.flatMap(p => p.holdings);
            const platformTransactions = data.investmentTransactions.filter(t => t.accountId === account.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return {
                account,
                holdings: allHoldings,
                transactions: platformTransactions,
            };
        });
    }, [data]);

    return (
        <div className="space-y-6 mt-4">
            <div className="flex justify-end">
                 <button onClick={onAddPlatform} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Platform</button>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                {platforms.map(p => (
                    <PlatformCard key={p.account.id} platform={p.account} holdings={p.holdings} transactions={p.transactions} onEdit={onEditPlatform} onDelete={onDeletePlatform} />
                ))}
            </div>
        </div>
    );
};

interface PlatformModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (platform: Account) => void;
    platformToEdit: Account | null;
}

const PlatformModal: React.FC<PlatformModalProps> = ({ isOpen, onClose, onSave, platformToEdit }) => {
    const [name, setName] = useState('');
    const [features, setFeatures] = useState('');
    const [assetTypes, setAssetTypes] = useState('');
    const [fees, setFees] = useState('');

    React.useEffect(() => {
        if (platformToEdit) {
            setName(platformToEdit.name);
            setFeatures(platformToEdit.platformDetails?.features.join('\n') || '');
            setAssetTypes(platformToEdit.platformDetails?.assetTypes.join('\n') || '');
            setFees(platformToEdit.platformDetails?.fees || '');
        } else {
            setName('');
            setFeatures('');
            setAssetTypes('');
            setFees('');
        }
    }, [platformToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newPlatform: Account = {
            id: platformToEdit ? platformToEdit.id : `acc${Date.now()}`,
            name,
            type: 'Investment',
            balance: platformToEdit ? platformToEdit.balance : 0,
            platformDetails: {
                features: features.split('\n').filter(f => f.trim() !== ''),
                assetTypes: assetTypes.split('\n').filter(a => a.trim() !== ''),
                fees,
            },
        };
        onSave(newPlatform);
        onClose();
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={platformToEdit ? 'Edit Platform' : 'Add New Platform'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div>
                    <label htmlFor="platform-name" className="block text-sm font-medium text-gray-700">Platform Name</label>
                    <input type="text" id="platform-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                </div>
                 <div>
                    <label htmlFor="platform-features" className="block text-sm font-medium text-gray-700">Features (one per line)</label>
                    <textarea id="platform-features" value={features} onChange={e => setFeatures(e.target.value)} rows={3} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                </div>
                 <div>
                    <label htmlFor="platform-assets" className="block text-sm font-medium text-gray-700">Supported Asset Types (one per line)</label>
                    <textarea id="platform-assets" value={assetTypes} onChange={e => setAssetTypes(e.target.value)} rows={3} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                </div>
                <div>
                    <label htmlFor="platform-fees" className="block text-sm font-medium text-gray-700">Fee Structure</label>
                    <input type="text" id="platform-fees" value={fees} onChange={e => setFees(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Platform</button>
            </form>
        </Modal>
    );
};
// #endregion


const Investments: React.FC = () => {
  const { data, addPlatform, updatePlatform, deletePlatform, recordTrade } = useContext(DataContext)!;
  const [activeTab, setActiveTab] = useState<InvestmentSubPage>('Platform');
  const [portfolios, setPortfolios] = useState<InvestmentPortfolio[]>(data.investments);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(portfolios[0]?.id || '');
  const [isAddPortfolioModalOpen, setIsAddPortfolioModalOpen] = useState(false);
  const [isHoldingModalOpen, setIsHoldingModalOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
  const [platformToEdit, setPlatformToEdit] = useState<Account | null>(null);
  const [isDeletePlatformModalOpen, setIsDeletePlatformModalOpen] = useState(false);
  const [platformToDelete, setPlatformToDelete] = useState<Account | null>(null);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);


  const investmentAccounts = useMemo(() => data.accounts.filter(acc => acc.type === 'Investment'), [data.accounts]);

  const selectedPortfolio = useMemo(() => {
    return portfolios.find(p => p.id === selectedPortfolioId) || portfolios[0];
  }, [selectedPortfolioId, portfolios]);

  const handleAddPortfolio = (name: string, accountId: string) => {
    const newPortfolio: InvestmentPortfolio = {
        id: `port${portfolios.length + 1}`,
        name,
        accountId,
        holdings: [],
    };
    setPortfolios([...portfolios, newPortfolio]);
    setSelectedPortfolioId(newPortfolio.id);
  };
  
  const handleHoldingClick = (holding: any) => {
      setSelectedHolding(holding);
      setIsHoldingModalOpen(true);
  }

  const handleOpenPlatformModal = (platform: Account | null = null) => {
    setPlatformToEdit(platform);
    setIsPlatformModalOpen(true);
  };

  const handleSavePlatform = (platform: Account) => {
    if (data.accounts.some(p => p.id === platform.id)) {
        updatePlatform(platform);
    } else {
        addPlatform(platform);
    }
  };

  const handleOpenDeletePlatformModal = (platform: Account) => {
    setPlatformToDelete(platform);
    setIsDeletePlatformModalOpen(true);
  };

  const handleConfirmDeletePlatform = () => {
    if (platformToDelete) {
        deletePlatform(platformToDelete.id);
        setIsDeletePlatformModalOpen(false);
        setPlatformToDelete(null);
    }
  };


  const renderContent = () => {
    switch (activeTab) {
      case 'Portfolio':
        return <PortfolioView portfolio={selectedPortfolio} onHoldingClick={handleHoldingClick} />;
      case 'Platform':
        return <PlatformView onAddPlatform={() => handleOpenPlatformModal()} onEditPlatform={handleOpenPlatformModal} onDeletePlatform={handleOpenDeletePlatformModal} />;
      case 'AI Rebalancer':
        return <AIRebalancerView />;
      case 'Watchlist':
        return <WatchlistView />;
      case 'Trade Advices':
        return <TradeAdvicesView />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
        <div className="flex justify-between items-center">
             <h1 className="text-3xl font-bold text-dark">Investments</h1>
             <div className="flex items-center space-x-2">
                <button onClick={() => setIsTradeModalOpen(true)} className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 transition-colors text-sm flex items-center">
                    <ArrowsRightLeftIcon className="h-4 w-4 mr-2" />
                    Record Trade
                </button>
                {activeTab === 'Portfolio' && (
                    <>
                        <select 
                            value={selectedPortfolioId} 
                            onChange={(e) => setSelectedPortfolioId(e.target.value)}
                            className="p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary shadow-sm"
                        >
                            {portfolios.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <button onClick={() => setIsAddPortfolioModalOpen(true)} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Portfolio</button>
                    </>
                )}
             </div>
        </div>
      
      {/* Sub-navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {INVESTMENT_SUB_PAGES.map(tab => (
            <button
              key={tab.name}
              onClick={() => setActiveTab(tab.name)}
              className={`${
                activeTab === tab.name
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } group inline-flex items-center whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              <tab.icon className="-ml-0.5 mr-2 h-5 w-5" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {renderContent()}

      <AddPortfolioModal 
        isOpen={isAddPortfolioModalOpen}
        onClose={() => setIsAddPortfolioModalOpen(false)}
        onAdd={handleAddPortfolio}
        investmentAccounts={investmentAccounts}
      />
      <HoldingDetailModal 
        isOpen={isHoldingModalOpen}
        onClose={() => setIsHoldingModalOpen(false)}
        holding={selectedHolding}
      />
      <PlatformModal
        isOpen={isPlatformModalOpen}
        onClose={() => setIsPlatformModalOpen(false)}
        onSave={handleSavePlatform}
        platformToEdit={platformToEdit}
      />
       <DeleteConfirmationModal 
        isOpen={isDeletePlatformModalOpen} 
        onClose={() => setIsDeletePlatformModalOpen(false)} 
        onConfirm={handleConfirmDeletePlatform} 
        itemName={platformToDelete?.name || ''} 
       />
       <RecordTradeModal
        isOpen={isTradeModalOpen}
        onClose={() => setIsTradeModalOpen(false)}
        onSave={recordTrade}
        investmentAccounts={investmentAccounts}
       />
    </div>
  );
};

export default Investments;
