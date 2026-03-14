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
    // Validate exchange rate
    const safeExchangeRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 3.75;
    
    // Calculate total value using the same function as Investments page
    const totalValueInSAR = getAllInvestmentsValueInSAR(portfolios, safeExchangeRate);
    
    // Calculate total invested (buy transactions) - convert to SAR
    const totalInvested = investmentTransactions
      .filter(t => t.type === 'buy')
      .reduce((sum, t) => {
        const amount = t.total ?? 0;
        const currency = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as 'USD' | 'SAR';
        return sum + (currency === 'SAR' ? amount : amount * safeExchangeRate);
      }, 0);
    
    // Calculate total withdrawn (sell transactions) - convert to SAR
    const totalWithdrawn = investmentTransactions
      .filter(t => t.type === 'sell')
      .reduce((sum, t) => {
        const amount = Math.abs(t.total ?? 0);
        const currency = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as 'USD' | 'SAR';
        return sum + (currency === 'SAR' ? amount : amount * safeExchangeRate);
      }, 0);
    
    // Calculate net capital (invested - withdrawn)
    const netCapital = totalInvested - totalWithdrawn;
    
    // Calculate gain/loss
    const totalGainLoss = totalValueInSAR - netCapital;
    
    // Calculate ROI - handle edge cases
    let roi = 0;
    if (netCapital > 0) {
      roi = (totalGainLoss / netCapital) * 100;
    } else if (netCapital === 0 && totalGainLoss > 0) {
      // Pure gains scenario (e.g., gifts, dividends reinvested)
      roi = Infinity;
    } else if (netCapital < 0) {
      // More withdrawn than invested (unusual but possible)
      roi = totalGainLoss > 0 ? Infinity : -100;
    }
    
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
      usdValue: usdValue * safeExchangeRate // Convert to SAR for display
    };
  }, [portfolios, investmentTransactions, exchangeRate]);

  // Loading state
  if (!data) {
    return (
      <div className="space-y-6">
        <SectionCard title="Investment Overview">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm text-slate-600">Loading investment data...</p>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

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
              ROI: {!Number.isFinite(metrics.roi) ? 'N/A' : metrics.roi >= 0 ? '+' : ''}{Number.isFinite(metrics.roi) ? metrics.roi.toFixed(2) + '%' : ''}
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
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Portfolio Breakdown</h3>
            {portfolios.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const csv = [
                    ['Portfolio Name', 'Holdings', 'Currency', 'Value (SAR)', 'Percentage'].join(','),
                    ...portfolios.map(p => {
                      const portfolioCurrency = (p.currency ?? 'USD') as 'USD' | 'SAR';
                      const portValue = (p.holdings ?? []).reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
                      const portValueInSAR = portfolioCurrency === 'SAR' ? portValue : portValue * exchangeRate;
                      const percentage = metrics.totalValueInSAR > 0 ? (portValueInSAR / metrics.totalValueInSAR) * 100 : 0;
                      return [
                        p.name,
                        p.holdings?.length ?? 0,
                        portfolioCurrency,
                        portValueInSAR.toFixed(2),
                        percentage.toFixed(2)
                      ].join(',');
                    })
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `portfolio-breakdown-${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Export CSV
              </button>
            )}
          </div>
          {portfolios.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500 mb-2">No portfolios yet.</p>
              <p className="text-xs text-slate-400">Create one in the Portfolios tab to see breakdown here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {portfolios.map(portfolio => {
                const portfolioCurrency = (portfolio.currency ?? 'USD') as 'USD' | 'SAR';
                const portValue = (portfolio.holdings ?? []).reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
                // Convert portfolio value to SAR for percentage calculation
                const portValueInSAR = portfolioCurrency === 'SAR' ? portValue : portValue * exchangeRate;
                const percentage = metrics.totalValueInSAR > 0 ? (portValueInSAR / metrics.totalValueInSAR) * 100 : 0;
                return (
                  <div key={portfolio.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">{portfolio.name}</p>
                      <p className="text-xs text-slate-500">
                        {portfolio.holdings?.length ?? 0} holding{portfolio.holdings?.length !== 1 ? 's' : ''} • 
                        {portfolioCurrency}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrencyString(portValue, { inCurrency: portfolioCurrency, digits: 0 })}</p>
                      <p className="text-xs text-slate-500">{percentage.toFixed(1)}% of total</p>
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
