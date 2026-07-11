import React, { useMemo } from 'react';
import { useFinancialEnhancementInsights } from '../../hooks/useFinancialEnhancementInsights';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Page } from '../../types';
import type { BudgetDriftRow } from '../../services/budgetDrift';
import { buildBudgetDrillDownAction, triggerSpendingDrillDown } from '../../services/spendingDrillDown';

export const DashboardCanIInvestCard: React.FC<{
  emergencyFundMonths: number;
  sarPerUsd: number;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  setSelectedCategory?: (category: string | null) => void;
  budgetDriftRows?: BudgetDriftRow[];
}> = ({ emergencyFundMonths, sarPerUsd, setActivePage, triggerPageAction, setSelectedCategory, budgetDriftRows = [] }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const { capitalDeployment } = useFinancialEnhancementInsights(emergencyFundMonths, {
    exchangeRate: sarPerUsd,
  });

  if (!capitalDeployment) return null;

  const deployable = capitalDeployment.investableSurplusSar ?? 0;
  const topDrift = useMemo(
    () =>
      [...budgetDriftRows]
        .filter((r) => r.driftPct > 0)
        .sort((a, b) => b.driftPct - a.driftPct)[0],
    [budgetDriftRows],
  );

  const drillTopDrift = () => {
    if (!topDrift?.category) return;
    setSelectedCategory?.(topDrift.category);
    triggerSpendingDrillDown(
      triggerPageAction,
      setActivePage,
      buildBudgetDrillDownAction({ budgetCategory: topDrift.category }),
      { setSelectedCategory },
    );
  };

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Can I invest?</p>
      <p className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
        {capitalDeployment.canInvest ? 'Yes — room to deploy' : 'Build buffer first'}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Investable surplus ~{formatCurrencyString(deployable, { digits: 0 })}
        {capitalDeployment.reasons[0] ? ` · ${capitalDeployment.reasons[0]}` : ''}
      </p>
      {topDrift ? (
        <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
          Top budget pressure: <span className="font-semibold">{topDrift.category}</span> (+{topDrift.driftPct.toFixed(0)}% vs 3-mo avg)
        </p>
      ) : null}
      {setActivePage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {topDrift ? (
            <button type="button" className="btn-secondary text-xs" onClick={drillTopDrift}>
              Review spending
            </button>
          ) : null}
          <button type="button" className="btn-secondary text-xs" onClick={() => setActivePage('Plan')}>
            Open Plan
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActivePage('Investments')}>
            Investments
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default DashboardCanIInvestCard;
