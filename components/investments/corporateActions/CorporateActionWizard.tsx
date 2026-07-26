import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../../Modal';
import { toast } from '../../../context/ToastContext';
import type { CorporateAction } from '../../../services/corporateActions';
import type { CorporateActionEvent, InvestmentPortfolio, InvestmentTransaction } from '../../../types';
import {
  buildCorporateActionFromWizardState,
  corporateActionWizardActionLabel,
  createInitialWizardState,
  getNextWizardStep,
  getPreviousWizardStep,
  holdingSymbolsForPortfolio,
  isCorporateActionWizardActionType,
  previewCorporateActionWizard,
  validateCorporateActionWizardPortfolioAccess,
  validateWizardStep,
  wizardStepLabel,
  wizardStepsForAction,
  type CorporateActionWizardActionType,
  type CorporateActionWizardPreview,
  type CorporateActionWizardState,
} from '../../../services/corporateActionWizardModel';
import { SplitWizardSteps } from './SplitWizardSteps';
import { SpinoffMergerWizardSteps } from './SpinoffMergerWizardSteps';
import { CashInLieuWizardSteps } from './CashInLieuWizardSteps';

const WIZARD_ACTION_OPTIONS: { value: CorporateActionWizardActionType; label: string }[] = [
  { value: 'stock_split', label: 'Stock split' },
  { value: 'reverse_stock_split', label: 'Reverse split' },
  { value: 'stock_dividend', label: 'Bonus / stock dividend' },
  { value: 'cash_in_lieu', label: 'Cash in lieu (fractional)' },
  { value: 'spinoff', label: 'Spinoff' },
  { value: 'merger', label: 'Merger / acquisition' },
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  portfolios: InvestmentPortfolio[];
  transactions?: InvestmentTransaction[];
  corporateActionEvents?: CorporateActionEvent[];
  initialState?: Partial<CorporateActionWizardState>;
  onApply: (args: {
    portfolioId: string;
    symbol: string;
    executionDate: string;
    action: CorporateAction;
    linkedSymbol?: string;
  }) => Promise<void>;
};

export const CorporateActionWizard: React.FC<Props> = ({
  isOpen,
  onClose,
  portfolios,
  transactions = [],
  corporateActionEvents = [],
  initialState,
  onApply,
}) => {
  const [state, setState] = useState<CorporateActionWizardState>(() => createInitialWizardState(initialState));
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<CorporateActionWizardPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const base = createInitialWizardState(initialState);
    if (!base.portfolioId && portfolios[0]?.id) {
      base.portfolioId = portfolios[0].id;
    }
    setState(base);
    setErrors([]);
    setPreview(null);
    setPreviewLoading(false);
    setBusy(false);
  }, [isOpen, initialState, portfolios]);

  const portfolio = useMemo(() => {
    const access = validateCorporateActionWizardPortfolioAccess(state.portfolioId, portfolios);
    return access.portfolio ?? portfolios[0];
  }, [portfolios, state.portfolioId]);

  const symbols = useMemo(() => holdingSymbolsForPortfolio(portfolio), [portfolio]);

  const patchState = useCallback((patch: Partial<CorporateActionWizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
    setErrors([]);
    setPreview(null);
  }, []);

  const runPreview = useCallback(async () => {
    if (!portfolio) return;
    const validation = validateWizardStep(state, portfolios, 'preview', {
      transactions,
      corporateActionEvents,
    });
    if (!validation.valid) {
      setErrors(validation.errors);
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setErrors([]);
    try {
      const result = await previewCorporateActionWizard({
        state,
        portfolio,
        transactions,
        corporateActionEvents,
      });
      if (result.errors.length) {
        setErrors(result.errors);
        setPreview(null);
      } else {
        setPreview(result);
      }
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Preview failed.']);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [corporateActionEvents, portfolio, portfolios, state, transactions]);

  useEffect(() => {
    if (!isOpen || state.step !== 'preview') return;
    void runPreview();
  }, [isOpen, runPreview, state.step]);

  const handleNext = () => {
    const validation = validateWizardStep(state, portfolios, state.step, {
      transactions,
      corporateActionEvents,
    });
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    const next = getNextWizardStep(state.step, state.actionType);
    if (!next) return;
    setErrors([]);
    setState((prev) => ({ ...prev, step: next }));
  };

  const handleBack = () => {
    const prev = getPreviousWizardStep(state.step, state.actionType);
    if (!prev) return;
    setErrors([]);
    setPreview(null);
    setState((s) => ({ ...s, step: prev }));
  };

  const handleApply = async () => {
    const validation = validateWizardStep(state, portfolios, 'confirm', {
      transactions,
      corporateActionEvents,
    });
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    const access = validateCorporateActionWizardPortfolioAccess(state.portfolioId, portfolios);
    if (!access.valid || !access.portfolio) {
      setErrors([access.error ?? 'Portfolio access denied.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const action = buildCorporateActionFromWizardState(state);
      await onApply({
        portfolioId: state.portfolioId,
        symbol: state.symbol,
        executionDate: state.executionDate,
        action,
        linkedSymbol: state.linkedSymbol.trim() || undefined,
      });
      if (state.actionType === 'stock_split' || state.actionType === 'reverse_stock_split') {
        toast('Split applied — net worth unchanged; share count and avg cost updated.', 'success');
      } else if (state.actionType === 'stock_dividend') {
        toast('Stock dividend applied — share count and avg cost updated (no cash).', 'success');
      }
      onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Failed to apply corporate action.']);
    } finally {
      setBusy(false);
    }
  };

  const steps = wizardStepsForAction(state.actionType);
  const stepIdx = steps.indexOf(state.step);

  const renderDetails = () => {
    if (
      state.actionType === 'stock_split' ||
      state.actionType === 'reverse_stock_split' ||
      state.actionType === 'stock_dividend'
    ) {
      return <SplitWizardSteps state={state} onChange={patchState} portfolio={portfolio} />;
    }
    if (state.actionType === 'spinoff' || state.actionType === 'merger') {
      return <SpinoffMergerWizardSteps state={state} onChange={patchState} />;
    }
    return <CashInLieuWizardSteps state={state} onChange={patchState} />;
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Corporate action wizard" maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Splits, spinoffs, and mergers update cost basis for P/L — not tax reporting (KSA scope).
        </p>

        <ol className="flex flex-wrap gap-2 text-xs font-semibold">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`rounded-full px-3 py-1 ${
                i === stepIdx ? 'bg-primary text-white' : i < stepIdx ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {wizardStepLabel(s)}
            </li>
          ))}
        </ol>

        {state.step === 'action' && (
          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-slate-600">Portfolio</span>
              <select
                className="input-base w-full"
                value={state.portfolioId || portfolio?.id || ''}
                onChange={(e) => patchState({ portfolioId: e.target.value, symbol: '' })}
              >
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-slate-600">Symbol</span>
              <select
                className="input-base w-full"
                value={state.symbol}
                onChange={(e) => patchState({ symbol: e.target.value })}
              >
                <option value="">Select…</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-slate-600">Action type</span>
              <select
                className="input-base w-full"
                value={state.actionType}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isCorporateActionWizardActionType(v)) patchState({ actionType: v });
                }}
              >
                {WIZARD_ACTION_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {state.step === 'details' && renderDetails()}

        {state.step === 'preview' && (
          <div className="space-y-3 text-sm">
            {previewLoading && <p className="text-slate-500">Computing dry-run preview…</p>}
            {!previewLoading && preview?.holding && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="font-semibold text-slate-800">{preview.holding.symbol}</p>
                <p>
                  Quantity: {preview.holding.beforeQuantity.toFixed(4)} →{' '}
                  <strong>{preview.holding.afterQuantity.toFixed(4)}</strong>
                </p>
                <p>
                  Avg cost: {preview.holding.beforeAvgCost.toFixed(4)} →{' '}
                  <strong>{preview.holding.afterAvgCost.toFixed(4)}</strong>
                </p>
                <p className="text-emerald-800 bg-emerald-50 rounded px-2 py-1 text-xs">
                  Total cost basis: {preview.holding.beforeCostBasis.toFixed(2)} →{' '}
                  <strong>{preview.holding.afterCostBasis.toFixed(2)}</strong> (unchanged)
                </p>
                {preview.holding.cashInLieu != null && preview.holding.cashInLieu > 0 && (
                  <p>Cash in lieu: <strong>{preview.holding.cashInLieu.toFixed(2)}</strong></p>
                )}
                {preview.holding.cashReceived != null && preview.holding.cashReceived > 0 && (
                  <p>Cash received: <strong>{preview.holding.cashReceived.toFixed(2)}</strong></p>
                )}
              </div>
            )}
            {!previewLoading && preview?.grant && (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                <p className="font-semibold text-indigo-900">Grant: {preview.grant.symbol}</p>
                <p>
                  {preview.grant.quantity.toFixed(4)} shares @ {preview.grant.avgCost.toFixed(4)} avg cost
                </p>
              </div>
            )}
            {!previewLoading && preview && preview.replaySymbols.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1">Portfolio replay (after apply)</p>
                <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                  {preview.replaySymbols.map((r) => (
                    <li key={r.symbol} className="flex justify-between gap-2 rounded bg-white px-2 py-1 border border-slate-100">
                      <span>{r.symbol}</span>
                      <span className="tabular-nums">
                        {r.quantity.toFixed(2)} @ {r.avgCost.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {state.step === 'confirm' && (
          <div className="space-y-2 text-sm rounded-lg border border-slate-200 p-3 bg-slate-50">
            <p>
              <strong>{corporateActionWizardActionLabel(state.actionType)}</strong> on {state.symbol}
            </p>
            <p>Portfolio: {portfolio?.name}</p>
            <p>Execution date: {state.executionDate}</p>
            <p>
              Ratio: {state.ratioNumerator}:{state.ratioDenominator}
            </p>
            {state.linkedSymbol && <p>Linked: {state.linkedSymbol}</p>}
            <p className="text-xs text-slate-500">Double-apply is blocked by idempotency; you can undo from the panel.</p>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="text-sm text-rose-700 space-y-1">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex gap-2">
            {state.step !== 'action' && (
              <button type="button" className="btn-secondary text-sm" onClick={handleBack} disabled={busy || previewLoading}>
                Back
              </button>
            )}
            <button type="button" className="text-sm text-slate-500 hover:text-slate-800 px-2" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
          {state.step !== 'confirm' ? (
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={handleNext}
              disabled={busy || previewLoading}
            >
              Next
            </button>
          ) : (
            <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => void handleApply()}>
              {busy ? 'Applying…' : 'Apply corporate action'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default CorporateActionWizard;
