import React, { useDeferredValue, useMemo, useState } from 'react';

const MAX_VISIBLE = 40;

export type SymbolPickerOption = { symbol: string; label: string };

/** Filterable symbol picker — avoids native `<select>` jank with large holding lists. */
export const SearchableSymbolPicker: React.FC<{
  options: SymbolPickerOption[];
  value: string;
  onChange: (symbol: string) => void;
  placeholder?: string;
  emptyLabel?: string;
}> = ({ options, value, onChange, placeholder = 'Search symbol…', emptyLabel = 'No holdings' }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selectedLabel = useMemo(
    () => options.find((o) => o.symbol === value)?.label ?? value,
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!deferredQuery) return options.slice(0, MAX_VISIBLE);
    return options
      .filter((o) => o.symbol.toLowerCase().includes(deferredQuery) || o.label.toLowerCase().includes(deferredQuery))
      .slice(0, MAX_VISIBLE);
  }, [deferredQuery, options]);

  if (!options.length) {
    return (
      <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        className="input-base w-full"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
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
      {open && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {filtered.map((o) => (
            <li key={o.symbol}>
              <button
                type="button"
                className={`w-full px-3 py-2 text-start hover:bg-primary/10 ${o.symbol === value ? 'bg-primary/5 font-semibold' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.symbol);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-slate-500">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
};
