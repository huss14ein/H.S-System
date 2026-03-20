import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';
import { sellScore } from '../services/decisionEngine';
import type { Holding, InvestmentPortfolio, Page } from '../types';

const LiquidationPlanner: React.FC<{ setActivePage?: (p: Page) => void }> = ({ setActivePage }) => {
  const { data, loading } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const { exchangeRate } = useCurrency();

  const ranked = useMemo(() => {
    const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
    const rows: { symbol: string; name: string; valueSAR: number; score: number; reasons: string }[] = [];
    let totalSAR = 0;
    portfolios.forEach((p: InvestmentPortfolio) => {
      const cur = p.currency || 'USD';
      (p.holdings || []).forEach((h: Holding) => {
        const v = toSAR(h.currentValue ?? 0, cur as 'USD' | 'SAR', exchangeRate);
        totalSAR += v;
      });
    });
    portfolios.forEach((p: InvestmentPortfolio) => {
      const cur = p.currency || 'USD';
      (p.holdings || []).forEach((h: Holding) => {
        const v = toSAR(h.currentValue ?? 0, cur as 'USD' | 'SAR', exchangeRate);
        const w = totalSAR > 0 ? (v / totalSAR) * 100 : 0;
        const { score, reasons } = sellScore({
          aboveTargetWeightPct: Math.max(0, w - 15),
          thesisBroken: false,
          needCash: w > 20,
        });
        rows.push({
          symbol: h.symbol,
          name: h.name || h.symbol,
          valueSAR: v,
          score,
          reasons: reasons.join(', ') || 'review',
        });
      });
    });
    return rows.sort((a, b) => b.score - a.score);
  }, [data, exchangeRate]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-spin h-10 w-10 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <PageLayout
      title="Liquidation planner"
      description="Rule-based sell urgency ranking (concentration)—not a recommendation to sell."
      action={
        setActivePage ? (
          <button type="button" className="btn-primary text-sm" onClick={() => setActivePage('Investments')}>
            Record trade
          </button>
        ) : undefined
      }
    >
      <SectionCard title="Ranked positions (higher = review trim first)">
        {ranked.length === 0 ? (
          <p className="text-sm text-slate-500">No holdings to rank.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2">Signals</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={`${r.symbol}-${i}`} className="border-b border-slate-50">
                    <td className="py-2 pr-4">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{r.symbol}</td>
                    <td className="py-2 pr-4">{formatCurrencyString(r.valueSAR, { digits: 0 })}</td>
                    <td className="py-2 pr-4 font-semibold text-violet-700">{r.score}</td>
                    <td className="py-2 text-slate-600">{r.reasons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageLayout>
  );
};

export default LiquidationPlanner;
