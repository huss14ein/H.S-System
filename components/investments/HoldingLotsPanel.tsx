/**
 * Open cost lots for a symbol (from `data.investmentCostLots`), with sold-quantity
 * and WAC-vs-FIFO book diagnostics so reconcile stays accountant-correct.
 *
 * This is NOT a buy/sell transaction log. Each row is a remaining BUY lot after FIFO
 * sells have consumed earlier shares. Fully sold lots are omitted.
 */
import React, { useContext, useMemo } from 'react';
import { DataContext } from '../../context/DataContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { InvestmentCostLot } from '../../types';
import {
  sumOpenLotBookCost,
  sumOpenLotQuantity,
  summarizeSymbolTradeQuantities,
} from '../../services/alignOpenLotsToHolding';

interface Props {
  symbol: string;
  /** Optional: restrict to a single portfolio's lots. */
  portfolioId?: string;
  /** Holding book quantity — compared to open-lot qty. */
  holdingQty?: number;
  /** Holding WAC avg cost — compared to FIFO open book. */
  holdingAvgCost?: number;
  compact?: boolean;
  /** Rebuild/align lots to the holding book (qty trim + optional cost match). */
  onAlignLotsToBook?: () => void | Promise<void>;
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

const HoldingLotsPanel: React.FC<Props> = ({
  symbol,
  portfolioId,
  holdingQty,
  holdingAvgCost,
  compact = false,
  onAlignLotsToBook,
}) => {
  const ctx = useContext(DataContext);
  const { formatCurrencyString } = useFormatCurrency();
  const lots = useMemo(
    () => selectOpenLotsForSymbol(ctx?.data?.investmentCostLots, symbol, portfolioId),
    [ctx?.data?.investmentCostLots, symbol, portfolioId],
  );

  const tradeSummary = useMemo(
    () =>
      summarizeSymbolTradeQuantities(ctx?.data?.investmentTransactions, symbol, {
        portfolioId,
      }),
    [ctx?.data?.investmentTransactions, symbol, portfolioId],
  );

  const totalQty = sumOpenLotQuantity(lots);
  const fifoBook = sumOpenLotBookCost(lots);
  const bookCcy = lots[0]?.bookCurrency === 'SAR' ? 'SAR' : 'USD';
  const wacBook =
    holdingQty != null && holdingAvgCost != null
      ? Number(holdingQty) * Number(holdingAvgCost)
      : null;
  const qtyMismatch =
    holdingQty != null && Number.isFinite(holdingQty) && Math.abs(totalQty - Number(holdingQty)) > 1e-6;
  const costMismatch =
    wacBook != null && Number.isFinite(wacBook) && Math.abs(fifoBook - wacBook) > 0.05;

  if (lots.length === 0) {
    return (
      <div className={compact ? 'mt-2 text-xs text-slate-500' : 'mt-3 text-sm text-slate-500'}>
        No open buy lots recorded for {String(symbol).toUpperCase()} (fully sold lots are not listed here).
        {tradeSummary.soldQty > 0 ? (
          <span className="block mt-1 text-slate-600">
            Trade ledger: {tradeSummary.boughtQty.toLocaleString()} bought · {tradeSummary.soldQty.toLocaleString()}{' '}
            sold · net {tradeSummary.netQty.toLocaleString()}.
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={
        compact ? 'mt-2 rounded-lg border border-slate-200 bg-white p-2' : 'mt-3 rounded-xl border border-slate-200 bg-white p-3'
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-slate-700">
          Open buy lots — {String(symbol).toUpperCase()}
        </span>
        <span className="text-xs text-slate-500">
          {totalQty.toLocaleString()} still open · {lots.length} buy lot(s)
        </span>
      </div>
      <p className="text-[11px] text-slate-600 mb-1 leading-relaxed">
        This is <strong>not</strong> a buy/sell trade list. Every row is a <strong>buy lot</strong> with shares still
        open after FIFO sells. Fully sold lots are hidden. Sell trades appear only in the ledger summary below — not as
        table rows.
      </p>
      <p className="text-[11px] text-slate-500 mb-2">
        Trade ledger: {tradeSummary.boughtQty.toLocaleString()} bought · {tradeSummary.soldQty.toLocaleString()} sold ·
        net {tradeSummary.netQty.toLocaleString()}
        {holdingQty != null ? ` · holding book ${Number(holdingQty).toLocaleString()}` : ''}
        {' · '}
        open-lot Σ {totalQty.toLocaleString()}
        {' · '}
        FIFO open book {formatCurrencyString(fifoBook, { digits: 2, inCurrency: bookCcy })}
        {wacBook != null
          ? ` · WAC purchased cost ${formatCurrencyString(wacBook, { digits: 2, inCurrency: bookCcy })}`
          : ''}
      </p>
      {(qtyMismatch || costMismatch) && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-[11px] text-amber-900">
          {qtyMismatch ? (
            <p>
              Open buy-lot quantity ({totalQty.toLocaleString()}) does not match holding book (
              {Number(holdingQty).toLocaleString()}). Sold / reconciled-down shares may not have been trimmed from
              these buy lots yet.
            </p>
          ) : null}
          {costMismatch ? (
            <p className={qtyMismatch ? 'mt-1' : undefined}>
              FIFO open-lot book differs from WAC purchased cost (common after partial sells, or when avg cost was
              restated without lot realignment). Use Reconcile holding or Align lots to book.
            </p>
          ) : null}
          {onAlignLotsToBook ? (
            <button
              type="button"
              className="mt-1.5 text-[11px] font-semibold text-emerald-800 underline underline-offset-2"
              onClick={() => void onAlignLotsToBook()}
            >
              Align open lots to book (trim sold qty + match cost basis)
            </button>
          ) : null}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">Type</th>
              <th className="py-1 pr-3">Buy date</th>
              <th className="py-1 pr-3">Open qty</th>
              <th className="py-1 pr-3">Cost / share</th>
              <th className="py-1 pr-3">Open book cost</th>
              <th className="py-1">Ccy</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const qty = Number(l.quantityRemaining) || 0;
              const cost = Number(l.costPerShare) || 0;
              return (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">
                    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-800 border border-emerald-200">
                      Buy lot
                    </span>
                  </td>
                  <td className="py-1 pr-3">{String(l.acquisitionDate).slice(0, 10)}</td>
                  <td className="py-1 pr-3">{qty.toLocaleString()}</td>
                  <td className="py-1 pr-3">
                    {formatCurrencyString(cost, { digits: 4, inCurrency: l.bookCurrency })}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCurrencyString(qty * cost, { digits: 2, inCurrency: l.bookCurrency })}
                  </td>
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
