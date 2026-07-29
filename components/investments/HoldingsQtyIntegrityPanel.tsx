/**
 * Per-symbol holdings qty vs portfolio_id ledger — Keep stored / Rebuild this symbol.
 * Used on Investments and System Health so repair is reachable where users manage positions.
 *
 * Keep stored / Keep closed: dismiss repair UI; KPIs use holdings.quantity (SSoT).
 * Missing + last leg buy → Restore holding (critical: trade in log, no open position).
 * Acks persist in settings.ui_acks (cross-device) with localStorage write-through.
 */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { DataContext } from '../../context/DataContext';
import { toast } from '../../context/ToastContext';
import {
  filterUnackedDriftRows,
  filterUnackedMissingRows,
  type HoldingsIntegrityAckMap,
} from '../../services/holdingsIntegrityAck';
import {
  acknowledgeHoldingsIntegrityDurable,
  clearHoldingsIntegrityAckDurable,
  resolveHoldingsIntegrityAcks,
} from '../../services/uiAcks';
import {
  buildHoldingsQtyDriftReport,
  holdingsQtyDriftNeedsAttention,
  listMissingLedgerHoldingsAcrossPortfolios,
  type HoldingsQtyDriftRow,
  type MissingLedgerHoldingRow,
} from '../../services/holdingsIntegrityRepair';
import { yieldToMain } from '../../utils/yieldToMain';
import HoldingLotsPanel from './HoldingLotsPanel';

type Props = {
  /** Compact for embedding under Investments KPIs. */
  compact?: boolean;
  /**
   * Open Reconcile quantity for this open holding (preferred when the broker statement is the truth
   * and the ledger may still be incomplete). Receives the stored holding id when found.
   */
  onReconcileQuantity?: (args: { holdingId: string; portfolioId: string; symbol: string }) => void;
  /** Align open lots to the stored holding book (trim + WAC cost match). */
  onAlignLotsToBook?: (args: { holdingId: string; portfolioId: string; symbol: string }) => void | Promise<void>;
};

const HoldingsQtyIntegrityPanel: React.FC<Props> = ({ compact = false, onReconcileQuantity, onAlignLotsToBook }) => {
  const ctx = useContext(DataContext);
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const data = ctx?.data;
  const updateSettings = ctx?.updateSettings;
  const [rebuildBusyKey, setRebuildBusyKey] = useState<string | null>(null);
  const [ackBusyKey, setAckBusyKey] = useState<string | null>(null);
  const [acks, setAcks] = useState<HoldingsIntegrityAckMap>(() =>
    resolveHoldingsIntegrityAcks(userId, data?.settings),
  );

  useEffect(() => {
    setAcks(resolveHoldingsIntegrityAcks(userId, data?.settings, { writeThrough: true }));
  }, [userId, data?.settings?.uiAcks]);

  const persistUiAcks = async (partial: import('../../types').Settings['uiAcks']) => {
    if (!updateSettings) return;
    // Pass only the partial map — updateSettings merges against dataRef so sibling acks stay fresh.
    await updateSettings({ uiAcks: partial ?? {} });
  };

  const driftAttention = useMemo(() => {
    if (!data) return [] as HoldingsQtyDriftRow[];
    return filterUnackedDriftRows(
      holdingsQtyDriftNeedsAttention(
        buildHoldingsQtyDriftReport({
          investments: data.investments,
          investmentTransactions: data.investmentTransactions,
          accounts: data.accounts,
        }),
      ),
      acks,
    );
  }, [data?.investments, data?.investmentTransactions, data?.accounts, acks]);

  const missingFromHoldings = useMemo(() => {
    if (!data) return [] as MissingLedgerHoldingRow[];
    return filterUnackedMissingRows(
      listMissingLedgerHoldingsAcrossPortfolios({
        investments: data.investments,
        investmentTransactions: data.investmentTransactions,
      }),
      acks,
    );
  }, [data?.investments, data?.investmentTransactions, acks]);

  const likelyOpenMissing = useMemo(
    () => missingFromHoldings.filter((r) => r.likelyOpen),
    [missingFromHoldings],
  );
  const soldOrIncompleteMissing = useMemo(
    () => missingFromHoldings.filter((r) => !r.likelyOpen),
    [missingFromHoldings],
  );

  if (!data || (driftAttention.length === 0 && missingFromHoldings.length === 0)) {
    return null;
  }

  const keepStored = (r: HoldingsQtyDriftRow) => {
    const key = `${r.portfolioId}:${r.symbol}`;
    if (ackBusyKey) return;
    setAckBusyKey(key);
    void (async () => {
      try {
        const next = await acknowledgeHoldingsIntegrityDurable({
          userId,
          portfolioId: r.portfolioId,
          symbol: r.symbol,
          kind: 'keep_stored',
          storedQty: r.storedQuantity,
          currentUiAcks: data.settings?.uiAcks,
          persistUiAcks,
        });
        setAcks(next);
        toast(
          `Kept stored ${String(r.symbol).slice(0, 32)}: ${r.storedQuantity.toLocaleString()} shares (KPIs use this book).`,
          'success',
        );
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not save dismissal.', 'error');
      } finally {
        setAckBusyKey(null);
      }
    })();
  };

  const keepClosed = (r: { portfolioId: string; symbol: string; ledgerNet: number }) => {
    const key = `${r.portfolioId}:${r.symbol}`;
    if (ackBusyKey) return;
    setAckBusyKey(key);
    void (async () => {
      try {
        const next = await acknowledgeHoldingsIntegrityDurable({
          userId,
          portfolioId: r.portfolioId,
          symbol: r.symbol,
          kind: 'keep_closed',
          storedQty: r.ledgerNet,
          currentUiAcks: data.settings?.uiAcks,
          persistUiAcks,
        });
        setAcks(next);
        toast(`Kept ${String(r.symbol).slice(0, 32)} closed — will not re-open from ledger.`, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not save dismissal.', 'error');
      } finally {
        setAckBusyKey(null);
      }
    })();
  };

  const rebuild = async (
    portfolioId: string,
    symbol: string,
    portfolioName: string,
    opts?: { expectedLedgerQty?: number; reopenSold?: boolean; restoreOpen?: boolean },
  ) => {
    if (!ctx?.rebuildHoldingsFromLedgerForSymbols) return;
    const key = `${portfolioId}:${symbol}`;
    const ok = window.confirm(
      opts?.restoreOpen
        ? `Restore holding for ${symbol} in “${portfolioName}”?\n\nTrades exist on this portfolio’s ledger (net ≈ ${opts.expectedLedgerQty?.toLocaleString() ?? '?'} shares) but there is no open holding.\nThis creates the position from the ledger so KPIs match your book.\nOnly this symbol is touched.`
        : opts?.reopenSold
          ? `RE-OPEN sold position ${symbol} in “${portfolioName}”?\n\nThis recreates a holding that is currently closed because the ledger still nets shares.\nPrefer Keep closed unless you are sure the ledger is complete and correct.\nOnly this symbol is touched.`
          : opts?.expectedLedgerQty != null
            ? `Rebuild ${symbol} in “${portfolioName}” from the portfolio ledger?\n\nThis only changes this symbol (ledger net ≈ ${opts.expectedLedgerQty.toLocaleString()}).\nPrefer Keep stored unless you trust the ledger for this symbol.`
            : `Rebuild ${symbol} in “${portfolioName}” from the portfolio ledger?\n\nOnly this symbol is touched. Prefer Keep stored unless you trust the ledger.`,
    );
    if (!ok) return;
    setRebuildBusyKey(key);
    try {
      await ctx.rebuildHoldingsFromLedgerForSymbols({ portfolioId, symbols: [symbol] });
      const next = await clearHoldingsIntegrityAckDurable({
        userId,
        portfolioId,
        symbol,
        currentUiAcks: data.settings?.uiAcks,
        persistUiAcks,
      });
      setAcks(next);
      toast(
        opts?.restoreOpen
          ? `Restored ${symbol} holding from ledger.`
          : opts?.reopenSold
            ? `Re-opened ${symbol} from ledger.`
            : `Rebuilt ${symbol} from ledger.`,
        'success',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Rebuild failed.', 'error');
    } finally {
      setRebuildBusyKey(null);
    }
  };

  const restoreAllLikelyOpen = async () => {
    if (!ctx?.rebuildHoldingsFromLedgerForSymbols || likelyOpenMissing.length === 0) return;
    const ok = window.confirm(
      `Restore ${likelyOpenMissing.length} missing holding(s) from the portfolio ledger?\n\nThese symbols have buys on the ledger but no open holding row.\nOnly those symbols are created/updated. Sold names with last-leg sell are not included.`,
    );
    if (!ok) return;
    setRebuildBusyKey('restore-all-open');
    try {
      const byPortfolio = new Map<string, string[]>();
      for (const r of likelyOpenMissing) {
        const list = byPortfolio.get(r.portfolioId) ?? [];
        list.push(r.symbol);
        byPortfolio.set(r.portfolioId, list);
      }
      let nextMap: HoldingsIntegrityAckMap = acks;
      for (const [portfolioId, symbols] of byPortfolio) {
        await ctx.rebuildHoldingsFromLedgerForSymbols({ portfolioId, symbols });
        for (const symbol of symbols) {
          nextMap = await clearHoldingsIntegrityAckDurable({
            userId,
            portfolioId,
            symbol,
            currentUiAcks: {
              ...(data.settings?.uiAcks ?? {}),
              holdingsQtyIntegrity: nextMap,
            },
            persistUiAcks,
          });
        }
        await yieldToMain(0);
      }
      setAcks(nextMap);
      toast(`Restored ${likelyOpenMissing.length} holding(s) from ledger.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed.', 'error');
    } finally {
      setRebuildBusyKey(null);
    }
  };

  const renderMissingRow = (r: MissingLedgerHoldingRow, mode: 'open' | 'sold') => {
    const key = `missing:${r.portfolioId}:${r.symbol}`;
    return (
      <li
        key={key}
        className={`flex flex-wrap items-center gap-2 justify-between border rounded-lg px-3 py-2 bg-white ${
          mode === 'open' ? 'border-rose-300' : 'border-slate-200'
        }`}
      >
        <span>
          <span className="font-medium text-slate-900">{r.symbol}</span>
          <span className="text-slate-500 text-xs ml-1">({r.portfolioName})</span>
          <span className={`block text-xs mt-0.5 ${mode === 'open' ? 'text-rose-900' : 'text-slate-600'}`}>
            {mode === 'open'
              ? `Trades on ledger (net ${r.ledgerNet.toLocaleString()}) but no holding — last leg is buy`
              : `Closed in holdings; ledger net ${r.ledgerNet.toLocaleString()} (last leg sell / incomplete)`}
          </span>
        </span>
        <span className="flex gap-2 relative z-10">
          {mode === 'sold' && (
            <button
              type="button"
              data-testid={`keep-closed-${r.symbol}`}
              disabled={ackBusyKey === `${r.portfolioId}:${r.symbol}`}
              className="text-xs px-2.5 py-1.5 rounded-md border border-slate-400 text-slate-900 bg-white hover:bg-slate-100 font-medium cursor-pointer shadow-sm disabled:opacity-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                keepClosed(r);
              }}
            >
              {ackBusyKey === `${r.portfolioId}:${r.symbol}` ? 'Saving…' : 'Keep closed'}
            </button>
          )}
          <button
            type="button"
            data-testid={mode === 'open' ? `restore-holding-${r.symbol}` : `reopen-${r.symbol}`}
            disabled={rebuildBusyKey === key || !ctx?.rebuildHoldingsFromLedgerForSymbols}
            className={
              mode === 'open'
                ? 'text-xs px-2.5 py-1.5 rounded-md border border-emerald-500 text-emerald-950 bg-emerald-50 hover:bg-emerald-100 font-semibold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed'
                : 'text-xs px-2.5 py-1.5 rounded-md border border-rose-400 text-rose-950 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed'
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void rebuild(r.portfolioId, r.symbol, r.portfolioName, {
                expectedLedgerQty: r.ledgerNet,
                reopenSold: mode === 'sold',
                restoreOpen: mode === 'open',
              });
            }}
          >
            {rebuildBusyKey === key
              ? 'Working…'
              : mode === 'open'
                ? 'Restore holding'
                : 'Rebuild (re-open)'}
          </button>
        </span>
      </li>
    );
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
        KPIs and net worth use <strong>stored holdings</strong> (single source of truth). If a symbol has trades in the
        log but no holding row, restore it here. Ledger scope is{' '}
        <code className="text-[11px]">portfolio_id</code> (not the whole platform account). To match broker share counts
        without restoring a missing row, use <strong>Reconcile quantity</strong> on that holding (audited delta —
        not a bulk rewrite).
      </p>

      {likelyOpenMissing.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-rose-950">
                Critical: trades on ledger, missing holding ({likelyOpenMissing.length})
              </p>
              <p className="text-[11px] text-rose-900/80 mt-0.5">
                Last leg is a buy and net shares &gt; 0 — these should appear under the portfolio.
              </p>
            </div>
            <button
              type="button"
              disabled={rebuildBusyKey === 'restore-all-open' || !ctx?.rebuildHoldingsFromLedgerForSymbols}
              className="text-xs px-3 py-1.5 rounded-md border border-emerald-600 text-white bg-emerald-600 hover:bg-emerald-700 font-semibold disabled:opacity-50 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void restoreAllLikelyOpen();
              }}
            >
              {rebuildBusyKey === 'restore-all-open' ? 'Restoring…' : 'Restore all missing holdings'}
            </button>
          </div>
          <ul className="mt-2 text-sm text-slate-700 space-y-2">
            {likelyOpenMissing.slice(0, 12).map((r) => renderMissingRow(r, 'open'))}
          </ul>
        </div>
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
                <span className="flex gap-2 relative z-10">
                  <button
                    type="button"
                    data-testid={`keep-stored-${r.symbol}`}
                    disabled={ackBusyKey === `${r.portfolioId}:${r.symbol}`}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-slate-400 text-slate-900 bg-white hover:bg-slate-100 font-medium cursor-pointer shadow-sm disabled:opacity-50"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      keepStored(r);
                    }}
                  >
                    {ackBusyKey === `${r.portfolioId}:${r.symbol}` ? 'Saving…' : 'Keep stored'}
                  </button>
                  {onReconcileQuantity && (
                    <button
                      type="button"
                      data-testid={`reconcile-qty-${r.symbol}`}
                      className="text-xs px-2.5 py-1.5 rounded-md border border-emerald-400 text-emerald-900 bg-emerald-50 hover:bg-emerald-100 font-medium cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const portfolio = (data?.investments ?? []).find((p) => p.id === r.portfolioId);
                        const holding = (portfolio?.holdings ?? []).find(
                          (h) => String(h.symbol ?? '').trim().toUpperCase() === r.symbol.toUpperCase(),
                        );
                        if (!holding?.id) {
                          toast(
                            'Open holding not found for this symbol — Restore/Rebuild first if it is missing.',
                            'info',
                          );
                          return;
                        }
                        onReconcileQuantity({
                          holdingId: holding.id,
                          portfolioId: r.portfolioId,
                          symbol: r.symbol,
                        });
                      }}
                    >
                      Reconcile quantity
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={rebuildBusyKey === key || !ctx?.rebuildHoldingsFromLedgerForSymbols}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-amber-400 text-amber-950 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void rebuild(r.portfolioId, r.symbol, r.portfolioName, {
                        expectedLedgerQty: r.ledgerQuantity,
                      });
                    }}
                  >
                    {rebuildBusyKey === key ? 'Rebuilding…' : 'Rebuild this symbol'}
                  </button>
                </span>
                <div className="w-full">
                  {(() => {
                    const portfolio = (data?.investments ?? []).find((p) => p.id === r.portfolioId);
                    const holding = (portfolio?.holdings ?? []).find(
                      (h) => String(h.symbol ?? '').trim().toUpperCase() === r.symbol.toUpperCase(),
                    );
                    return (
                      <HoldingLotsPanel
                        symbol={r.symbol}
                        portfolioId={r.portfolioId}
                        compact
                        holdingQty={holding?.quantity}
                        holdingAvgCost={holding?.avgCost}
                        onAlignLotsToBook={
                          holding?.id && onAlignLotsToBook
                            ? () =>
                                onAlignLotsToBook({
                                  holdingId: holding.id,
                                  portfolioId: r.portfolioId,
                                  symbol: r.symbol,
                                })
                            : undefined
                        }
                      />
                    );
                  })()}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {soldOrIncompleteMissing.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-700">
            Ledger still nets shares (sold / incomplete history)
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Last leg is a sell (or incomplete ledger). Prefer Keep closed unless you intend to re-open.
          </p>
          <ul className="mt-2 text-sm text-slate-700 space-y-2">
            {soldOrIncompleteMissing.slice(0, 8).map((r) => renderMissingRow(r, 'sold'))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default HoldingsQtyIntegrityPanel;
