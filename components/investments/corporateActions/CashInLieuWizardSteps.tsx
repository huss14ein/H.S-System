import React from 'react';
import type { CorporateActionWizardState } from '../../../services/corporateActionWizardModel';
import { corporateActionWizardActionLabel } from '../../../services/corporateActionWizardModel';

type Props = {
  state: CorporateActionWizardState;
  onChange: (patch: Partial<CorporateActionWizardState>) => void;
};

export const CashInLieuWizardSteps: React.FC<Props> = ({ state, onChange }) => {
  if (state.actionType !== 'cash_in_lieu' && state.actionType !== 'reverse_stock_split') return null;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        {state.actionType === 'cash_in_lieu'
          ? 'Fractional shares from a split are cashed out at the stated price; whole shares keep adjusted cost basis.'
          : 'Reverse splits may cash out fractional remainders — enter the cash-in-lieu price per fractional share.'}
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
      <label className="block space-y-1">
        <span className="text-slate-600">Cash-in-lieu price per fractional share</span>
        <input
          className="input-base w-full"
          value={state.cashInLieuPrice}
          onChange={(e) => onChange({ cashInLieuPrice: e.target.value })}
          inputMode="decimal"
          placeholder="e.g. 150.00"
        />
      </label>
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
      </p>
    </div>
  );
};

export default CashInLieuWizardSteps;
