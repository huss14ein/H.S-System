import React from 'react';
import type { InvestmentPortfolio } from '../../../types';
import type { CorporateActionWizardState } from '../../../services/corporateActionWizardModel';
import { corporateActionWizardActionLabel, wizardReverseSplitNeedsCashInLieu } from '../../../services/corporateActionWizardModel';
import type { CorporateActionWizardActionType } from '../../../services/corporateActionWizardModel';

type Props = {
  state: CorporateActionWizardState;
  onChange: (patch: Partial<CorporateActionWizardState>) => void;
  portfolio?: InvestmentPortfolio;
};

const SPLIT_TYPES: CorporateActionWizardActionType[] = ['stock_split', 'reverse_stock_split', 'stock_dividend'];

export const SplitWizardSteps: React.FC<Props> = ({ state, onChange, portfolio }) => {
  if (!SPLIT_TYPES.includes(state.actionType)) return null;

  const holding = portfolio?.holdings?.find(
    (h) => String(h.symbol ?? '').toUpperCase() === state.symbol.toUpperCase(),
  );
  const needsCashInLieu = wizardReverseSplitNeedsCashInLieu(state, Number(holding?.quantity) || 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        {state.actionType === 'stock_split'
          ? 'Enter the split ratio as new shares : old shares (e.g. 2:1 doubles quantity and halves average cost).'
          : state.actionType === 'stock_dividend'
            ? 'Bonus / stock dividend ratio as new total shares : old shares (e.g. 1.1:1 for a 10% stock dividend). Adjusts quantity and average cost with no cash.'
            : 'Enter the reverse split ratio as new shares : old shares (e.g. 1:10 reduces quantity and raises average cost).'}
      </p>
      <label className="block space-y-1">
        <span className="text-slate-600">Ratio (new : old)</span>
        <div className="flex gap-2 items-center">
          <input
            className="input-base w-full"
            value={state.ratioNumerator}
            onChange={(e) => onChange({ ratioNumerator: e.target.value })}
            inputMode="decimal"
          />
          <span className="text-slate-400">:</span>
          <input
            className="input-base w-full"
            value={state.ratioDenominator}
            onChange={(e) => onChange({ ratioDenominator: e.target.value })}
            inputMode="decimal"
          />
        </div>
      </label>
      {needsCashInLieu && (
        <label className="block space-y-1">
          <span className="text-slate-600">Cash-in-lieu price per fractional share</span>
          <input
            className="input-base w-full"
            value={state.cashInLieuPrice}
            onChange={(e) => onChange({ cashInLieuPrice: e.target.value })}
            inputMode="decimal"
            placeholder="Broker cash-out price for fraction"
          />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-slate-600">Execution date</span>
        <input
          type="date"
          className="input-base w-full"
          value={state.executionDate}
          onChange={(e) => onChange({ executionDate: e.target.value })}
        />
      </label>
      <p className="text-xs text-slate-500">
        Action: {corporateActionWizardActionLabel(state.actionType)} on <strong>{state.symbol}</strong>
        {state.actionType === 'reverse_stock_split' && !needsCashInLieu
          ? ' — no fractional shares; cash-in-lieu not required.'
          : ''}
      </p>
    </div>
  );
};

export default SplitWizardSteps;
