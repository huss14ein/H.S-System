import React, { useMemo } from 'react';
import type { HoldingSymbolOption } from '../services/holdingSymbolOptions';

export interface HoldingSymbolSelectProps {
  id?: string;
  options: HoldingSymbolOption[];
  value: string;
  onChange: (option: HoldingSymbolOption | null) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
  /** Shown under the control when a holding is selected. */
  hint?: string | null;
}

const HoldingSymbolSelect: React.FC<HoldingSymbolSelectProps> = ({
  id = 'holding-symbol-select',
  options,
  value,
  onChange,
  required = true,
  disabled = false,
  className = 'w-full min-h-[44px] px-4 py-2.5 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent',
  emptyLabel = 'Select a holding you own…',
  hint,
}) => {
  const selected = useMemo(
    () => options.find((o) => o.optionKey === value) ?? null,
    [options, value],
  );

  return (
    <div>
      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled || options.length === 0}
        onChange={(e) => {
          const key = e.target.value;
          if (!key) {
            onChange(null);
            return;
          }
          const opt = options.find((o) => o.optionKey === key) ?? null;
          onChange(opt);
        }}
        className={className}
      >
        <option value="">{options.length === 0 ? 'No holdings — add positions in Portfolios first' : emptyLabel}</option>
        {options.map((o) => (
          <option key={o.optionKey} value={o.optionKey}>
            {o.symbol}
            {o.name && o.name !== o.symbol ? ` — ${o.name}` : ''} · {o.portfolioName} · qty {o.quantity}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {selected && !hint ? (
        <p className="mt-1 text-xs text-slate-500">
          {selected.portfolioName} · up to {selected.quantity} shares available
        </p>
      ) : null}
    </div>
  );
};

export default HoldingSymbolSelect;
