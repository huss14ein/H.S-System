import React, { useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR } from '../utils/currencyMath';

/** Comprehensive overview tab for Investments: total value, portfolio breakdown, and performance metrics. */
const InvestmentOverview: React.FC = () => {
  const { data } = React.useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const { exchangeRate } = useCurrency();
  const portfolios = data?.investments ?? [];
  const investmentTransactions = data?.investmentTransactions ?? [];
  
  const metrics = useMemo(() => {
    // Calculate total value using the same function as Investments page
    const totalValueInSAR = getAllInvestmentsValueInSAR(portfolios, exchangeRate);
    
    // Calculate total invested (buy transactions)
    const totalInvested = investmentTransactions
      .filter(t => t.type === 'buy')
      .reduce((sum, t) => sum + (t.total ?? 0), 0);
    
    // Calculate total withdrawn (sell transactions)
    const totalWithdrawn = Math.abs(
      investmentTransactions
        .filter(t => t.type === 'sell')
        .reduce((sum, t) => sum + (t.total ?? 0), 0)
    );
    
    // Calculate net capital (invested - withdrawn)
    const netCapital = totalInvested - totalWithdrawn;
    
    // Calculate gain/loss
    const totalGainLoss = totalValueInSAR - netCapital;
    
    // Calculate ROI
    const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
    
    // Portfolio count and holdings count
    const portfolioCount = portfolios.length;
    const totalHoldings = portfolios.reduce((sum, p) => sum + (p.holdings?.length ?? 0), 0);
    
    // Currency breakdown
    const sarPortfolios = portfolios.filter(p => (p.currency ?? 'USD') === 'SAR');
    const usdPortfolios = portfolios.filter(p => (p.currency ?? 'USD') === 'USD');
    const sarValue = sarPortfolios.reduce((sum, p) => {
      const portVal = (p.holdings ?? []).reduce((s, h) => s + (h.currentValue ?? 0), 0);
      return sum + portVal;
    }, 0);
    const usdValue = usdPortfolios.reduce((sum, p) => {
      const portVal = (p.holdings ?? []).reduce((s, h) => s + (h.currentValue ?? 0), 0);
      return sum + portVal;
    }, 0);
    
    return {
      totalValueInSAR,
      totalInvested,
      totalWithdrawn,
      netCapital,
      totalGainLoss,
      roi,
      portfolioCount,
      totalHoldings,
      sarValue,
      usdValue: usdValue * exchangeRate // Convert to SAR for display
    };
  }, [portfolios, investmentTransactions, exchangeRate]);

  return (
    <div className="space-y-6">
      <SectionCard title="Investment Overview">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Total Value</p>
            <p className="text-2xl font-bold text-blue-900">{formatCurrencyString(metrics.totalValueInSAR, { digits: 0 })}</p>
            <p className="text-xs text-blue-600 mt-1">
              {metrics.portfolioCount} portfolio{metrics.portfolioCount !== 1 ? 's' : ''} • {metrics.totalHoldings} holding{metrics.totalHoldings !== 1 ? 's' : ''}
            </p>
          </div>
          
          <div className={`bg-gradient-to-br rounded-xl p-4 border ${
            metrics.totalGainLoss >= 0 
              ? 'from-emerald-50 to-emerald-100 border-emerald-200' 
              : 'from-red-50 to-red-100 border-red-200'
          }`}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${
              metrics.totalGainLoss >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}>Total Gain/Loss</p>
            <p className={`text-2xl font-bold ${
              metrics.totalGainLoss >= 0 ? 'text-emerald-900' : 'text-red-900'
            }`}>
              {metrics.totalGainLoss >= 0 ? '+' : ''}{formatCurrencyString(metrics.totalGainLoss, { digits: 0 })}
            </p>
            <p className={`text-xs mt-1 ${
              metrics.totalGainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}>
              ROI: {metrics.roi >= 0 ? '+' : ''}{metrics.roi.toFixed(2)}%
            </p>
          </div>
          
          <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-4 border border-indigo-200">
            <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">Total Invested</p>
            <p className="text-2xl font-bold text-indigo-900">{formatCurrencyString(metrics.totalInvested, { digits: 0 })}</p>
            <p className="text-xs text-indigo-600 mt-1">
              Net: {formatCurrencyString(metrics.netCapital, { digits: 0 })}
            </p>
          </div>
          
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
            <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">Currency Split</p>
            <p className="text-sm font-bold text-purple-900">SAR: {formatCurrencyString(metrics.sarValue, { digits: 0 })}</p>
            <p className="text-sm font-bold text-purple-900">USD: {formatCurrencyString(metrics.usdValue, { digits: 0 })}</p>
          </div>
        </div>
        
        <div className="border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Portfolio Breakdown</h3>
          {portfolios.length === 0 ? (
            <p className="text-sm text-slate-500">No portfolios yet. Create one in the Portfolios tab.</p>
          ) : (
            <div className="space-y-2">
              {portfolios.map(portfolio => {
                const portValue = (portfolio.holdings ?? []).reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
                const percentage = metrics.totalValueInSAR > 0 ? (portValue / metrics.totalValueInSAR) * 100 : 0;
                return (
                  <div key={portfolio.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">{portfolio.name}</p>
                      <p className="text-xs text-slate-500">
                        {portfolio.holdings?.length ?? 0} holding{portfolio.holdings?.length !== 1 ? 's' : ''} • 
                        {portfolio.currency || 'USD'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrencyString(portValue, { digits: 0 })}</p>
                      <p className="text-xs text-slate-500">{percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

export default InvestmentOverview;
