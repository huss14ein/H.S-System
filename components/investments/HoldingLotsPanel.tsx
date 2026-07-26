/**
 * Read-only view of open cost lots for a symbol (from `data.investmentCostLots`).
 * Shows quantity remaining, acquisition date, cost per share, and lot currency so a
 * user reconciling quantity/WAC can see how the position is composed.
 *
 * Usage (embedded in a holding detail or the qty-integrity panel):
 *   <HoldingLotsPanel symbol="AAPL" portfolioId={portfolio.id} compact />
 */
import React, { useContext, useMemo } from 'react';
import { DataContext } from '../../context/DataContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { InvestmentCostLot } from '../../types';

interface Props {
  symbol: string;
  /** Optional: restrict to a single portfolio's lots. */
  portfolioId?: string;
  compact?: boolean;
}

export function selectOpenLotsForSymbol(
  lots: InvestmentCostLot[] | null | undefined,
  symbol: string,
  portfolioId?: string,
): InvestmentCostLot[] {
  const sym = String(symbol ?? '').trim().toUpperCase();
  if (!sym) return [];
  return (lots ?? [])
    .filter((l) => String(l.symbol ?? '').trim().toUpperCase() === sym)
    .filter((l) => !portfolioId || l.portfolioId === portfolioId)
    .filter((l) => (Number(l.quantityRemaining) || 0) > 1e-9)
    .sort((a, b) => String(a.acquisitionDate).localeCompare(String(b.acquisitionDate)));
}

const HoldingLotsPanel: React.FC<Props> = ({ symbol, portfolioId, compact = false }) => {
  const ctx = useContext(DataContext);
  const { formatCurrencyString } = useFormatCurrency();
  const lots = useMemo(
    () => selectOpenLotsForSymbol(ctx?.data?.investmentCostLots, symbol, portfolioId),
    [ctx?.data?.investmentCostLots, symbol, portfolioId],
  );

  const totalQty = lots.reduce((s, l) => s + (Number(l.quantityRemaining) || 0), 0);

  if (lots.length === 0) {
    return (
      <div className={compact ? 'mt-2 text-xs text-slate-500' : 'mt-3 text-sm text-slate-500'}>
        No open cost lots recorded for {String(symbol).toUpperCase()}.
      </div>
    );
  }

  return (
    <div className={compact ? 'mt-2 rounded-lg border border-slate-200 bg-white p-2' : 'mt-3 rounded-xl border border-slate-200 bg-white p-3'}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-semibold text-slate-700">
          Open lots — {String(symbol).toUpperCase()}
        </span>
        <span className="text-xs text-slate-500">{totalQty.toLocaleString()} shares in {lots.length} lot(s)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">Acquired</th>
              <th className="py-1 pr-3">Qty remaining</th>
              <th className="py-1 pr-3">Cost / share</th>
              <th className="py-1 pr-3">Book cost</th>
              <th className="py-1">Ccy</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const qty = Number(l.quantityRemaining) || 0;
              const cost = Number(l.costPerShare) || 0;
              return (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{String(l.acquisitionDate).slice(0, 10)}</td>
                  <td className="py-1 pr-3">{qty.toLocaleString()}</td>
                  <td className="py-1 pr-3">{formatCurrencyString(cost, { digits: 2 })}</td>
                  <td className="py-1 pr-3">{formatCurrencyString(qty * cost, { digits: 0 })}</td>
                  <td className="py-1">{l.bookCurrency}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HoldingLotsPanel;
