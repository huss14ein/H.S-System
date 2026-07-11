import React from 'react';
import type { CorporateActionWizardState } from '../../../services/corporateActionWizardModel';
import { corporateActionWizardActionLabel } from '../../../services/corporateActionWizardModel';

type Props = {
  state: CorporateActionWizardState;
  onChange: (patch: Partial<CorporateActionWizardState>) => void;
};

export const SpinoffMergerWizardSteps: React.FC<Props> = ({ state, onChange }) => {
  if (state.actionType !== 'spinoff' && state.actionType !== 'merger') return null;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        {state.actionType === 'spinoff'
          ? 'Parent shares keep reduced cost basis; child shares are granted per the spinoff ratio.'
          : 'Parent symbol is exchanged for acquirer shares (and optional cash).'}
      </p>
      <label className="block space-y-1">
        <span className="text-slate-600">
          {state.actionType === 'spinoff' ? 'Child symbol' : 'Acquirer symbol'}
        </span>
        <input
          className="input-base w-full"
          value={state.linkedSymbol}
          onChange={(e) => onChange({ linkedSymbol: e.target.value.toUpperCase() })}
          placeholder={state.actionType === 'spinoff' ? 'e.g. SPIN.SR' : 'e.g. ACQ'}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-slate-600">
          {state.actionType === 'spinoff' ? 'Child shares per parent share' : 'Conversion ratio (new : old)'}
        </span>
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
      {state.actionType === 'spinoff' && (
        <label className="block space-y-1">
          <span className="text-slate-600">Cost basis to child (0–1, e.g. 0.2 = 20%)</span>
          <input
            className="input-base w-full"
            value={state.costBasisAllocationPct}
            onChange={(e) => onChange({ costBasisAllocationPct: e.target.value })}
            inputMode="decimal"
          />
        </label>
      )}
      {state.actionType === 'merger' && (
        <label className="block space-y-1">
          <span className="text-slate-600">Cash per share (optional)</span>
          <input
            className="input-base w-full"
            value={state.cashPerShare}
            onChange={(e) => onChange({ cashPerShare: e.target.value })}
            inputMode="decimal"
            placeholder="0"
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
      </p>
    </div>
  );
};

export default SpinoffMergerWizardSteps;
