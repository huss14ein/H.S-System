import React, { useEffect, useState } from 'react';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import {
  clearPlanDashboardCompareContext,
  loadPlanDashboardCompareContext,
  type PlanDashboardCompareContext,
} from '../services/planDashboardCompareContext';

type Props = {
  dashboardNetWorthSar: number;
  dashboardMonthlyPnLSar: number;
  onOpenPlan?: () => void;
};

const PlanCompareContextBanner: React.FC<Props> = ({ dashboardNetWorthSar, dashboardMonthlyPnLSar, onOpenPlan }) => {
  const { formatCurrencyString, formatCurrency } = useFormatCurrency();
  const [ctx, setCtx] = useState<PlanDashboardCompareContext | null>(null);

  useEffect(() => {
    setCtx(loadPlanDashboardCompareContext());
  }, []);

  if (!ctx) return null;

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/80 p-4 shadow-sm" role="status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-violet-950">Opened from Plan — compare metrics</p>
          <p className="text-xs text-violet-900/90 mt-1 leading-relaxed max-w-3xl">
            Plan {ctx.year} YTD net (cashflow):{' '}
            <strong>{formatCurrencyString(ctx.planYtdActualNetSar, { inCurrency: 'SAR', digits: 0 })}</strong>
            {' · '}
            Dashboard net worth (balance sheet):{' '}
            <strong>{formatCurrencyString(dashboardNetWorthSar, { inCurrency: 'SAR', digits: 0 })}</strong>
            {' · '}
            This month P&amp;L (KPI): <strong>{formatCurrency(dashboardMonthlyPnLSar)}</strong>
            . These are different families by design — not merged into one headline.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {onOpenPlan && (
            <button
              type="button"
              className="text-xs font-semibold text-violet-800 hover:underline"
              onClick={onOpenPlan}
            >
              Back to Plan →
            </button>
          )}
          <button
            type="button"
            className="text-xs font-semibold text-violet-800 hover:underline"
            onClick={() => {
              clearPlanDashboardCompareContext();
              setCtx(null);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanCompareContextBanner;
