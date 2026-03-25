import React, { useMemo, useContext, useState, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { useSelfLearning } from '../context/SelfLearningContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { sellScore } from '../services/decisionEngine';
import { thesisValidityCheck, type ThesisRecord } from '../services/thesisJournalEngine';
import type { Holding, InvestmentPortfolio, Page } from '../types';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel } from '../components/SymbolWithCompanyName';

const THESIS_KEY = 'finova_thesis_records_v1';

function getHoldingValue(h: Holding): number {
  const cv = Number(h.currentValue);
  if (Number.isFinite(cv) && cv > 0) return cv;
  const ext = h as { quantity?: number; shares?: number; currentPrice?: number; avgCost?: number; averageCost?: number };
  const qty = Number(ext.quantity ?? ext.shares ?? 0);
  const price = Number(ext.currentPrice ?? ext.avgCost ?? ext.averageCost ?? 0);
  return qty > 0 && Number.isFinite(price) ? qty * price : 0;
}

function loadTheses(): ThesisRecord[] {
  try {
    const raw = localStorage.getItem(THESIS_KEY);
    return raw ? (JSON.parse(raw) as ThesisRecord[]) : [];
  } catch {
    return [];
  }
}

interface LiquidationPlannerProps {
  setActivePage?: (p: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  dataTick?: number;
}

const LiquidationPlanner: React.FC<LiquidationPlannerProps> = ({ setActivePage, triggerPageAction, dataTick }) => {
  const { data, loading } = useContext(DataContext)!;
  const { trackAction } = useSelfLearning();
  const { formatCurrencyString } = useFormatCurrency();
  const { exchangeRate } = useCurrency();
  const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
  const [theses, setTheses] = useState<ThesisRecord[]>([]);

  useEffect(() => {
    setTheses(loadTheses());
  }, [dataTick]);

  const thesisBySymbol = useMemo(() => {
    const m = new Map<string, ThesisRecord>();
    theses.forEach((t) => m.set((t.symbol || '').toUpperCase(), t));
    return m;
  }, [theses]);

  const ranked = useMemo(() => {
    const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
    const rows: { symbol: string; name: string; valueSAR: number; score: number; reasons: string; hasThesis: boolean }[] = [];
    let totalSAR = 0;
    portfolios.forEach((p: InvestmentPortfolio) => {
      const cur = p.currency || 'USD';
      (p.holdings || []).forEach((h: Holding) => {
        const rawVal = getHoldingValue(h);
        const v = toSAR(rawVal, cur as 'USD' | 'SAR', sarPerUsd);
        totalSAR += v;
      });
    });
    portfolios.forEach((p: InvestmentPortfolio) => {
      const cur = p.currency || 'USD';
      (p.holdings || []).forEach((h: Holding) => {
        const rawVal = getHoldingValue(h);
        const v = toSAR(rawVal, cur as 'USD' | 'SAR', sarPerUsd);
        const w = totalSAR > 0 ? (v / totalSAR) * 100 : 0;
        const sym = (h.symbol || '').toUpperCase();
        const thesis = thesisBySymbol.get(sym);
        const thesisBroken = thesis ? !thesisValidityCheck(thesis).valid : false;
        const { score, reasons } = sellScore({
          aboveTargetWeightPct: Math.max(0, w - 15),
          thesisBroken,
          needCash: w > 20,
        });
        rows.push({
          symbol: h.symbol,
          name: h.name || h.symbol,
          valueSAR: v,
          score,
          reasons: [thesisBroken ? 'Review needed' : null, reasons.join(', ') || 'review'].filter(Boolean).join(', '),
          hasThesis: !!thesis,
        });
      });
    });
    return rows.sort((a, b) => b.score - a.score);
  }, [data, sarPerUsd, thesisBySymbol]);

  const liqSymbols = useMemo(
    () => Array.from(new Set(ranked.map((r) => (r.symbol || '').trim()).filter((s) => s.length >= 2))),
    [ranked],
  );
  const { names: liqCompanyNames } = useCompanyNames(liqSymbols);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-spin h-10 w-10 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <PageLayout
      title="What to consider selling first"
      description="A simple list of your investments, ranked by when you might want to review them. Higher scores = consider looking at sooner. Not a recommendation to sell—just a helpful order to check."
      action={
        setActivePage ? (
          <div className="flex flex-wrap items-center gap-2">
            {triggerPageAction && (
              <>
                <button type="button" className="text-sm text-primary-600 hover:text-primary-700 underline" onClick={() => { trackAction('link-journal', 'Engines & Tools'); triggerPageAction('Engines & Tools', 'openJournal'); }}>
                  My notes & ideas
                </button>
                <button type="button" className="text-sm text-primary-600 hover:text-primary-700 underline" onClick={() => { trackAction('link-risk-trading', 'Engines & Tools'); triggerPageAction('Engines & Tools', 'openRiskTradingHub'); }}>
                  Safety & rules
                </button>
              </>
            )}
            <button type="button" className="btn-primary text-sm" onClick={() => { trackAction('link-investments', 'Engines & Tools'); setActivePage('Investments'); }}>
              Record a trade
            </button>
          </div>
        ) : undefined
      }
    >
      <SectionCard title="Your investments, ranked by review priority" infoHint="Higher scores indicate when you might want to look at trimming—e.g. if one holding is too big, or your notes say it's time to revisit. Not financial advice." collapsible collapsibleSummary={`${ranked.length} holdings ranked`} defaultExpanded>
        {ranked.length === 0 ? (
          <p className="text-sm text-slate-500">No investments yet. Add holdings in Investments to see them here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Investment</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4" title="Higher = consider reviewing sooner">Priority</th>
                  <th className="py-2">Why</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={`${r.symbol}-${i}`} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-3 pr-4 text-slate-500">{i + 1}</td>
                    <td className="py-3 pr-4 font-medium text-slate-900 min-w-0 max-w-[200px]">
                      <ResolvedSymbolLabel
                        symbol={r.symbol}
                        storedName={r.name}
                        names={liqCompanyNames}
                        layout="stacked"
                        symbolClassName="font-medium text-slate-900"
                        companyClassName="text-xs text-slate-500"
                      />
                    </td>
                    <td className="py-3 pr-4">{formatCurrencyString(r.valueSAR, { digits: 0 })}</td>
                    <td className="py-3 pr-4">
                      <span className={`font-semibold ${r.score >= 50 ? 'text-amber-700' : 'text-slate-700'}`}>{r.score}</span>
                    </td>
                    <td className="py-3 text-slate-600 text-xs sm:text-sm">{r.reasons}</td>
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
