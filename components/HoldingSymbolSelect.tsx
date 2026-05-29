import React, { useDeferredValue, useMemo, useState } from 'react';
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
  /** When true (default), option text includes portfolio name — omit when list is already scoped to one portfolio. */
  showPortfolioInLabel?: boolean;
  /** Shown under the control when a holding is selected. */
  hint?: string | null;
}

const MAX_VISIBLE = 40;

function formatOptionLabel(o: HoldingSymbolOption, showPortfolioInLabel: boolean): string {
  const namePart = o.name && o.name !== o.symbol ? ` — ${o.name}` : '';
  const portfolioPart = showPortfolioInLabel ? ` · ${o.portfolioName}` : '';
  return `${o.symbol}${namePart}${portfolioPart} · qty ${o.quantity}`;
}

/** Filterable holding picker — avoids native select jank with large holding lists. */
const HoldingSymbolSelect: React.FC<HoldingSymbolSelectProps> = ({
  id = 'holding-symbol-select',
  options,
  value,
  onChange,
  required = true,
  disabled = false,
  className = 'input-base w-full',
  emptyLabel = 'Select a holding you own…',
  showPortfolioInLabel = true,
  hint,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selected = useMemo(
    () => options.find((o) => o.optionKey === value) ?? null,
    [options, value],
  );

  const selectedLabel = selected ? formatOptionLabel(selected, showPortfolioInLabel) : '';

  const filtered = useMemo(() => {
    if (!deferredQuery) return options.slice(0, MAX_VISIBLE);
    return options
      .filter((o) => {
        const label = formatOptionLabel(o, showPortfolioInLabel).toLowerCase();
        return (
          o.symbol.toLowerCase().includes(deferredQuery) ||
          label.includes(deferredQuery) ||
          o.portfolioName.toLowerCase().includes(deferredQuery)
        );
      })
      .slice(0, MAX_VISIBLE);
  }, [deferredQuery, options, showPortfolioInLabel]);

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        No holdings — add positions in Portfolios first
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type="text"
          required={required && !value}
          disabled={disabled}
          className={className}
          value={open ? query : selectedLabel}
          placeholder={emptyLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onBlur={() => {
            setTimeout(() => {
              setOpen(false);
              setQuery('');
            }, 150);
          }}
        />
        {open && !disabled && (
          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
            <li>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-slate-500 hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {emptyLabel}
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o.optionKey}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-start hover:bg-primary/10 ${o.optionKey === value ? 'bg-primary/5 font-semibold' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  {formatOptionLabel(o, showPortfolioInLabel)}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-2 text-slate-500">No matches</li>}
          </ul>
        )}
      </div>
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
