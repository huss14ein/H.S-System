import type { PriceRefreshScope } from '../context/MarketDataContext';

/** Merge an incoming refresh scope into the FIFO queue (dedupe storms). */
export function mergePriceRefreshScope(
  queue: PriceRefreshScope[],
  incoming: PriceRefreshScope,
): { queue: PriceRefreshScope[]; changed: boolean } {
  if (incoming.kind === 'symbols') {
    const symbols = normalizeSymbolList(incoming.symbols);
    if (symbols.length === 0) return { queue, changed: false };
    const idx = queue.findIndex((s) => s.kind === 'symbols');
    if (idx >= 0) {
      const existing = queue[idx]!;
      if (existing.kind !== 'symbols') return { queue, changed: false };
      const mergedSymbols = normalizeSymbolList([...existing.symbols, ...symbols]);
      const forceFetch = existing.forceFetch === true || incoming.forceFetch === true;
      if (
        mergedSymbols.length === existing.symbols.length &&
        forceFetch === (existing.forceFetch === true)
      ) {
        return { queue, changed: false };
      }
      const next = [...queue];
      next[idx] = { kind: 'symbols', symbols: mergedSymbols, forceFetch: forceFetch || undefined };
      return { queue: next, changed: true };
    }
    return {
      queue: [...queue, { kind: 'symbols', symbols, forceFetch: incoming.forceFetch || undefined }],
      changed: true,
    };
  }

  if (incoming.kind === 'all') {
    const existingAll = queue.find((s) => s.kind === 'all');
    const forceFetch =
      incoming.forceFetch === true || (existingAll?.kind === 'all' && existingAll.forceFetch === true);
    if (existingAll?.kind === 'all' && (existingAll.forceFetch === true) === forceFetch) {
      return { queue, changed: false };
    }
    const next: PriceRefreshScope[] = queue.filter((s) => s.kind !== 'all');
    next.push({ kind: 'all', forceFetch: forceFetch || undefined });
    return { queue: next, changed: true };
  }

  if (incoming.kind === 'platform') {
    const platformId = incoming.platformId.trim();
    if (!platformId) return { queue, changed: false };
    const idx = queue.findIndex((s) => s.kind === 'platform' && s.platformId === platformId);
    if (idx >= 0) {
      const existing = queue[idx]!;
      if (existing.kind !== 'platform') return { queue, changed: false };
      const forceFetch = existing.forceFetch === true || incoming.forceFetch === true;
      if (forceFetch === (existing.forceFetch === true)) return { queue, changed: false };
      const next = [...queue];
      next[idx] = { kind: 'platform', platformId, forceFetch: forceFetch || undefined };
      return { queue: next, changed: true };
    }
    return {
      queue: [...queue, { kind: 'platform', platformId, forceFetch: incoming.forceFetch || undefined }],
      changed: true,
    };
  }

  return { queue, changed: false };
}

function normalizeSymbolList(symbols: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const s = (raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
