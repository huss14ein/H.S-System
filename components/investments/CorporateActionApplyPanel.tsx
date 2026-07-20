import React, { useMemo, useState } from 'react';
import type { CorporateActionEvent, InvestmentPortfolio, InvestmentTransaction } from '../../types';
import type { CorporateAction, CorporateActionType } from '../../services/corporateActions';
import { splitProducesFraction } from '../../services/corporateActions';
import { buildCorporateActionEventPayload, validateCorporateActionApplyPrerequisites } from '../../services/corporateActionApply';
import { validateCorporateActionWizardPortfolioAccess } from '../../services/corporateActionWizardModel';
import { toast } from '../../context/ToastContext';

type Props = {
  portfolios: InvestmentPortfolio[];
  events?: CorporateActionEvent[];
  investmentTransactions?: InvestmentTransaction[];
  onApply: (args: {
    portfolioId: string;
    symbol: string;
    executionDate: string;
    action: CorporateAction;
    linkedSymbol?: string;
  }) => Promise<void>;
  onUndo?: (eventId: string) => Promise<void>;
  onLaunchWizard?: (prefill?: { portfolioId?: string; symbol?: string; actionType?: CorporateActionType }) => void;
};

const ACTION_TYPES: { value: CorporateActionType; label: string }[] = [
  { value: 'stock_split', label: 'Stock split' },
  { value: 'reverse_stock_split', label: 'Reverse split' },
  { value: 'cash_in_lieu', label: 'Cash in lieu (fractional)' },
  { value: 'spinoff', label: 'Spinoff' },
  { value: 'merger', label: 'Merger / acquisition' },
];

export const CorporateActionApplyPanel: React.FC<Props> = ({
  portfolios,
  events = [],
  investmentTransactions = [],
  onApply,
  onUndo,
  onLaunchWizard,
}) => {
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? '');
  const [symbol, setSymbol] = useState('');
  const [actionType, setActionType] = useState<CorporateActionType>('stock_split');
  const [executionDate, setExecutionDate] = useState(new Date().toISOString().slice(0, 10));
  const [ratioNum, setRatioNum] = useState('2');
  const [ratioDen, setRatioDen] = useState('1');
  const [linkedSymbol, setLinkedSymbol] = useState('');
  const [costPct, setCostPct] = useState('0.2');
  const [cashPerShare, setCashPerShare] = useState('');
  const [cashInLieuPrice, setCashInLieuPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoBusyId, setUndoBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portfolio = useMemo(
    () => portfolios.find((p) => p.id === portfolioId) ?? portfolios[0],
    [portfolios, portfolioId],
  );

  const symbols = useMemo(() => {
    const set = new Set<string>();
    (portfolio?.holdings ?? []).forEach((h: { symbol?: string }) => {
      if (h.symbol) set.add(h.symbol.toUpperCase());
    });
    return Array.from(set).sort();
  }, [portfolio]);

  const selectedHolding = useMemo(
    () => portfolio?.holdings?.find((h) => String(h.symbol ?? '').toUpperCase() === symbol.toUpperCase()),
    [portfolio, symbol],
  );

  const reverseSplitNeedsCashInLieu = useMemo(() => {
    if (actionType !== 'reverse_stock_split' || !symbol) return false;
    const action: CorporateAction = {
      type: 'reverse_stock_split',
      ratioNumerator: Number(ratioNum) || 1,
      ratioDenominator: Number(ratioDen) || 1,
    };
    return splitProducesFraction(Number(selectedHolding?.quantity) || 0, action);
  }, [actionType, ratioDen, ratioNum, selectedHolding?.quantity, symbol]);

  const recentEvents = useMemo(
    () =>
      [...events]
        .filter((e) => e.status !== 'reversed')
        .sort((a, b) => String(b.executionDate).localeCompare(String(a.executionDate)))
        .slice(0, 8),
    [events],
  );

  const handleApply = async () => {
    if (!portfolio?.id || !symbol.trim()) {
      setError('Select portfolio and symbol.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const access = validateCorporateActionWizardPortfolioAccess(portfolio.id, portfolios);
      if (!access.valid) {
        setError(access.error ?? 'Invalid portfolio.');
        setBusy(false);
        return;
      }
      const action: CorporateAction = {
        type: actionType,
        ratioNumerator: Number(ratioNum) || 1,
        ratioDenominator: Number(ratioDen) || 1,
        costBasisAllocationPct: Number(costPct) || 0,
        linkedSymbol: linkedSymbol.trim() || undefined,
        cashPerShare: cashPerShare ? Number(cashPerShare) : undefined,
        cashInLieuPrice: cashInLieuPrice ? Number(cashInLieuPrice) : undefined,
        conversionRatio: (Number(ratioNum) || 1) / (Number(ratioDen) || 1),
      };
      if (actionType === 'cash_in_lieu' || reverseSplitNeedsCashInLieu) {
        const price = Number(cashInLieuPrice);
        if (!Number.isFinite(price) || price < 0) {
          setError('Cash-in-lieu price per fractional share is required.');
          setBusy(false);
          return;
        }
      }
      const prereq = validateCorporateActionApplyPrerequisites({
        portfolioId: portfolio.id,
        symbol: symbol.trim(),
        transactions: investmentTransactions,
        corporateActionEvents: events,
        accountId: portfolio.accountId ?? (portfolio as { account_id?: string }).account_id,
        holdingSymbols: (portfolio.holdings ?? []).map((h) => String(h.symbol ?? '')),
      });
      if (!prereq.valid) {
        setError(prereq.error ?? 'Corporate action prerequisites not met.');
        setBusy(false);
        return;
      }
      buildCorporateActionEventPayload({
        portfolioId: portfolio.id,
        symbol: symbol.trim(),
        executionDate,
        action,
        linkedSymbol: linkedSymbol.trim() || undefined,
      });
      await onApply({
        portfolioId: portfolio.id,
        symbol: symbol.trim(),
        executionDate,
        action,
        linkedSymbol: linkedSymbol.trim() || undefined,
      });
      if (actionType === 'stock_split' || actionType === 'reverse_stock_split') {
        toast('Split applied — net worth unchanged; share count and avg cost updated.', 'success');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply corporate action.');
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async (eventId: string) => {
    if (!onUndo) return;
    setUndoBusyId(eventId);
    setError(null);
    try {
      await onUndo(eventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to undo corporate action.');
    } finally {
      setUndoBusyId(null);
    }
  };

  if (!portfolios.length) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Corporate actions</h3>
          <p className="text-xs text-slate-500 mt-1">
            Splits, spinoffs, and mergers update cost basis for P/L — not tax reporting (KSA scope). Double-apply is
            blocked by idempotency; undo restores holdings.
          </p>
        </div>
        {onLaunchWizard && (
          <button
            type="button"
            className="btn-secondary text-sm shrink-0"
            onClick={() =>
              onLaunchWizard({
                portfolioId: portfolio?.id,
                symbol: symbol || undefined,
                actionType,
              })
            }
          >
            Guided wizard…
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <label className="space-y-1">
          <span className="text-slate-600">Portfolio</span>
          <select className="input-base w-full" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-slate-600">Symbol</span>
          <select className="input-base w-full" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="">Select…</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-slate-600">Action</span>
          <select
            className="input-base w-full"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as CorporateActionType)}
          >
            {ACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-slate-600">Execution date</span>
          <input type="date" className="input-base w-full" value={executionDate} onChange={(e) => setExecutionDate(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-slate-600">Ratio (new : old)</span>
          <div className="flex gap-2">
            <input className="input-base w-full" value={ratioNum} onChange={(e) => setRatioNum(e.target.value)} />
            <span className="self-center text-slate-400">:</span>
            <input className="input-base w-full" value={ratioDen} onChange={(e) => setRatioDen(e.target.value)} />
          </div>
        </label>
        {(actionType === 'spinoff' || actionType === 'merger') && (
          <label className="space-y-1 sm:col-span-2">
            <span className="text-slate-600">Linked symbol (child / acquirer)</span>
            <input className="input-base w-full" value={linkedSymbol} onChange={(e) => setLinkedSymbol(e.target.value)} placeholder="e.g. SPIN.SR" />
          </label>
        )}
        {actionType === 'spinoff' && (
          <label className="space-y-1">
            <span className="text-slate-600">Cost basis to child (%)</span>
            <input className="input-base w-full" value={costPct} onChange={(e) => setCostPct(e.target.value)} />
          </label>
        )}
        {actionType === 'merger' && (
          <label className="space-y-1">
            <span className="text-slate-600">Cash per share (optional)</span>
            <input className="input-base w-full" value={cashPerShare} onChange={(e) => setCashPerShare(e.target.value)} />
          </label>
        )}
        {(actionType === 'cash_in_lieu' || reverseSplitNeedsCashInLieu) && (
          <label className="space-y-1 sm:col-span-2">
            <span className="text-slate-600">Cash-in-lieu price per fractional share</span>
            <input
              className="input-base w-full"
              value={cashInLieuPrice}
              onChange={(e) => setCashInLieuPrice(e.target.value)}
              placeholder="e.g. 150.00"
            />
          </label>
        )}
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => void handleApply()}>
        {busy ? 'Applying…' : 'Apply corporate action'}
      </button>

      {recentEvents.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Recent applied events</h4>
          <ul className="space-y-2 text-xs">
            {recentEvents.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span>
                  <strong>{ev.symbol}</strong> · {ev.actionType.replace(/_/g, ' ')} · {ev.executionDate}
                </span>
                {onUndo && (
                  <button
                    type="button"
                    className="text-primary font-medium hover:underline"
                    disabled={undoBusyId === ev.id}
                    onClick={() => void handleUndo(ev.id)}
                  >
                    {undoBusyId === ev.id ? 'Undoing…' : 'Undo'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default CorporateActionApplyPanel;
