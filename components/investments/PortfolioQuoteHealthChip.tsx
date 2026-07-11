import React, { useMemo } from 'react';
import type { InvestmentPortfolio } from '../../types';
import { resolvePortfolioQuoteHealth } from '../../services/zakatHoldingBadge';

const STYLES = {
  fresh: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  stale: 'bg-amber-50 text-amber-900 border-amber-200',
  missing: 'bg-slate-50 text-slate-600 border-slate-200',
} as const;

const LABELS = {
  fresh: 'Quotes fresh',
  stale: 'Quotes stale',
  missing: 'No live marks',
} as const;

export const PortfolioQuoteHealthChip: React.FC<{
  portfolio: InvestmentPortfolio;
  symbolQuoteUpdatedAt: Record<string, string | undefined>;
  className?: string;
}> = ({ portfolio, symbolQuoteUpdatedAt, className = '' }) => {
  const state = useMemo(
    () => resolvePortfolioQuoteHealth({ portfolio, symbolQuoteUpdatedAt }),
    [portfolio, symbolQuoteUpdatedAt],
  );

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLES[state]} ${className}`}
      title="Derived from last quote refresh timestamps — no extra API calls"
    >
      {LABELS[state]}
    </span>
  );
};

export default PortfolioQuoteHealthChip;
