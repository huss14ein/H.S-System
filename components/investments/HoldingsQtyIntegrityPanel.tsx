/**
 * Per-symbol holdings qty vs portfolio_id ledger — Keep stored / Rebuild this symbol.
 * Used on Investments and System Health so repair is reachable where users manage positions.
 */
import React, { useContext, useMemo, useState } from 'react';
import { DataContext } from '../../context/DataContext';
import {
  buildHoldingsQtyDriftReport,
  holdingsQtyDriftNeedsAttention,
  listLedgerSymbolsMissingFromHoldings,
  type HoldingsQtyDriftRow,
} from '../../services/holdingsIntegrityRepair';
import { getPersonalInvestments } from '../../utils/wealthScope';

type Props = {
  /** Compact for embedding under Investments KPIs. */
  compact?: boolean;
};

const HoldingsQtyIntegrityPanel: React.FC<Props> = ({ compact = false }) => {
  const ctx = useContext(DataContext);
  const data = ctx?.data;
  const [rebuildBusyKey, setRebuildBusyKey] = useState<string | null>(null);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

  const driftAttention = useMemo(() => {
    if (!data) return [] as HoldingsQtyDriftRow[];
    return holdingsQtyDriftNeedsAttention(buildHoldingsQtyDriftReport(data));
  }, [data]);

  const missingFromHoldings = useMemo(() => {
    if (!data) return [] as { portfolioId: string; portfolioName: string; symbol: string }[];
    const out: { portfolioId: string; portfolioName: string; symbol: string }[] = [];
    for (const portfolio of getPersonalInvestments(data)) {
      for (const symbol of listLedgerSymbolsMissingFromHoldings({
        portfolio,
        transactions: data.investmentTransactions ?? [],
      })) {
        out.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name ?? portfolio.id,
          symbol,
        });
      }
    }
    return out;
  }, [data]);

  if (!data || (driftAttention.length === 0 && missingFromHoldings.length === 0)) {
    return null;
  }

  const rebuild = async (portfolioId: string, symbol: string, portfolioName: string, expectedLedgerQty?: number) => {
    if (!ctx?.rebuildHoldingsFromLedgerForSymbols) return;
    const key = `${portfolioId}:${symbol}`;
    const ok = window.confirm(
      expectedLedgerQty != null
        ? `Rebuild ${symbol} in “${portfolioName}” from the portfolio ledger?\n\nThis only changes this symbol (ledger net ≈ ${expectedLedgerQty.toLocaleString()}).`
        : `Rebuild ${symbol} in “${portfolioName}” from the portfolio ledger?\n\nThis may re-open a closed position if the ledger still nets shares. Only this symbol is touched.`,
    );
    if (!ok) return;
    setRebuildBusyKey(key);
    setRebuildMessage(null);
    try {
      await ctx.rebuildHoldingsFromLedgerForSymbols({ portfolioId, symbols: [symbol] });
      setRebuildMessage(`Rebuilt ${symbol} from ledger.`);
    } catch (err) {
      setRebuildMessage(err instanceof Error ? err.message : 'Rebuild failed.');
    } finally {
      setRebuildBusyKey(null);
    }
  };

  return (
    <div
      id="holdings-qty-integrity"
      className={
        compact
          ? 'mt-3 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 scroll-mt-20'
          : 'mt-4 pt-4 border-t border-slate-200 scroll-mt-20'
      }
    >
      <h4 className={`font-semibold text-slate-800 ${compact ? 'text-sm' : 'text-sm'}`}>
        Holdings quantity integrity
      </h4>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
        Stored share counts vs buy−sell on <code className="text-[11px]">portfolio_id</code>-scoped ledger rows.
        Trades no longer auto-rebuild the book. Default is <strong>Keep stored</strong>; rebuild only when you trust
        the ledger for that symbol.
      </p>
      {rebuildMessage && (
        <p className="text-xs text-slate-700 mt-2 rounded border border-slate-200 bg-white px-2 py-1">{rebuildMessage}</p>
      )}

      {driftAttention.length > 0 && (
        <ul className="mt-2 text-sm text-slate-700 space-y-2">
          {driftAttention.slice(0, 12).map((r) => {
            const key = `${r.portfolioId}:${r.symbol}`;
            return (
              <li
                key={key}
                className="flex flex-wrap items-center gap-2 justify-between border border-slate-200 rounded-lg px-3 py-2 bg-white"
              >
                <span>
                  <span className="font-medium text-slate-900">{r.symbol}</span>
                  <span className="text-slate-500 text-xs ml-1">({r.portfolioName})</span>
                  <span className="block text-xs text-amber-900 mt-0.5">
                    Stored {r.storedQuantity.toLocaleString()} vs ledger {r.ledgerQuantity.toLocaleString()} (drift{' '}
                    {r.drift >= 0 ? '+' : ''}
                    {r.drift.toLocaleString()})
                  </span>
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 bg-slate-50"
                    onClick={() =>
                      setRebuildMessage(
                        `Kept stored quantity for ${r.symbol} (${r.storedQuantity.toLocaleString()}). No ledger rebuild.`,
                      )
                    }
                  >
                    Keep stored
                  </button>
                  <button
                    type="button"
                    disabled={rebuildBusyKey === key || !ctx?.rebuildHoldingsFromLedgerForSymbols}
                    className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-950 bg-amber-50 disabled:opacity-50"
                    onClick={() => rebuild(r.portfolioId, r.symbol, r.portfolioName, r.ledgerQuantity)}
                  >
                    {rebuildBusyKey === key ? 'Rebuilding…' : 'Rebuild this symbol'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {missingFromHoldings.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-700">
            Ledger still nets shares (not currently held)
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Rebuilding these would re-open the position. Prefer Keep closed unless the ledger is complete and correct.
          </p>
          <ul className="mt-2 text-sm text-slate-700 space-y-2">
            {missingFromHoldings.slice(0, 8).map((r) => {
              const key = `missing:${r.portfolioId}:${r.symbol}`;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-2 justify-between border border-slate-200 rounded-lg px-3 py-2 bg-white"
                >
                  <span>
                    <span className="font-medium text-slate-900">{r.symbol}</span>
                    <span className="text-slate-500 text-xs ml-1">({r.portfolioName})</span>
                    <span className="block text-xs text-slate-600 mt-0.5">Closed in holdings; ledger net &gt; 0</span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 bg-slate-50"
                      onClick={() => setRebuildMessage(`Kept ${r.symbol} closed. No rebuild.`)}
                    >
                      Keep closed
                    </button>
                    <button
                      type="button"
                      disabled={rebuildBusyKey === key || !ctx?.rebuildHoldingsFromLedgerForSymbols}
                      className="text-xs px-2 py-1 rounded border border-rose-300 text-rose-950 bg-rose-50 disabled:opacity-50"
                      onClick={() => rebuild(r.portfolioId, r.symbol, r.portfolioName)}
                    >
                      {rebuildBusyKey === key ? 'Rebuilding…' : 'Rebuild (re-open)'}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default HoldingsQtyIntegrityPanel;
