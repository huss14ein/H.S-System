import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { normalizeSymbolKeyForCompanyLookup } from '../services/staticCompanyNameService';

export type SymbolNamesMap = Record<string, string | null>;

/**
 * Resolve company name: stored (DB) first, then Finnhub/static cache from `names`.
 * Keys in `names` must match `normalizeSymbolKeyForCompanyLookup(symbol)`.
 */
export function resolveCompanyDisplayName(
  symbol: string,
  storedName: string | null | undefined,
  names: SymbolNamesMap,
): { symbol: string; company: string | null } {
  const sym = (symbol || '').trim();
  if (!sym) return { symbol: '', company: null };
  const key = normalizeSymbolKeyForCompanyLookup(sym);
  const fromApi = key ? names[key] : undefined;
  const company =
    (storedName?.trim() || (fromApi && fromApi !== key ? fromApi : null)) || null;
  if (company && company === sym) return { symbol: sym, company: null };
  return { symbol: sym, company };
}

/** Single-line label for charts (treemap, tooltips). */
export function formatSymbolWithCompany(
  symbol: string,
  storedName: string | null | undefined,
  names: SymbolNamesMap,
): string {
  const { symbol: sym, company } = resolveCompanyDisplayName(symbol, storedName, names);
  if (!sym) return '—';
  if (company) return `${company} · ${sym}`;
  return sym;
}

type ResolvedProps = {
  symbol: string;
  storedName?: string | null;
  names: SymbolNamesMap;
  className?: string;
  symbolClassName?: string;
  companyClassName?: string;
  layout?: 'stacked' | 'inline';
};

/** Use when parent already called `useCompanyNames(symbols)` for the page/table. */
export function ResolvedSymbolLabel({
  symbol,
  storedName,
  names,
  className = '',
  symbolClassName = 'font-semibold text-slate-900',
  companyClassName = 'text-xs text-slate-500 font-normal',
  layout = 'stacked',
}: ResolvedProps) {
  const { symbol: sym, company } = resolveCompanyDisplayName(symbol, storedName, names);
  if (!sym) return null;
  if (layout === 'inline') {
    return (
      <span className={className} title={company ? `${company} (${sym})` : sym}>
        <span className={symbolClassName}>{sym}</span>
        {company ? <span className={`${companyClassName} ml-1`}>{company}</span> : null}
      </span>
    );
  }
  return (
    <span className={className} title={company ? `${company}` : sym}>
      <span className={`block ${symbolClassName}`}>{sym}</span>
      {company ? <span className={`block ${companyClassName}`}>{company}</span> : null}
    </span>
  );
}

type AutoProps = Omit<ResolvedProps, 'names'> & {
  /** When provided, skips an extra hook in this subtree (use for batched tables). */
  names?: SymbolNamesMap;
};

/**
 * Auto-resolves company name via Finnhub + static fallback (cached). Prefer passing `names` from a parent `useCompanyNames` when rendering many rows.
 */
export function SymbolWithCompanyName({
  symbol,
  storedName,
  names: namesProp,
  ...rest
}: AutoProps) {
  const sym = (symbol || '').trim();
  const key = normalizeSymbolKeyForCompanyLookup(sym);
  const shouldFetch = !namesProp && key.length >= 2;
  const { names: hookNames, loading } = useCompanyNames(shouldFetch ? [sym] : []);
  const map = namesProp ?? hookNames;

  if (!sym) return null;

  if (loading && !namesProp && !storedName?.trim() && !(map[key] && map[key] !== key)) {
    return (
      <span className={rest.className}>
        <span className={rest.symbolClassName ?? 'font-semibold text-slate-900'}>{sym}</span>
        <span className={`block ${rest.companyClassName ?? 'text-xs text-slate-400'}`}>…</span>
      </span>
    );
  }

  return <ResolvedSymbolLabel symbol={sym} storedName={storedName} names={map} {...rest} />;
}

export function symbolsFromHoldings(holdings: Array<{ symbol?: string | null }>): string[] {
  return Array.from(
    new Set(holdings.map((h) => (h.symbol || '').trim()).filter((s) => s.length >= 2)),
  );
}
