import type { FinancialData, Holding, InvestmentTransaction } from '../types';
import { toSAR } from '../utils/currencyMath';

export interface ZakatTradeSuggestion {
  symbol: string;
  reason: string;
  impactDescription: string;
}

export interface ZakatAdviceSummary {
  suggestions: ZakatTradeSuggestion[];
}

export function buildZakatTradeAdvice(data: FinancialData | null | undefined): ZakatAdviceSummary {
  if (!data) return { suggestions: [] };

  const investments = (data as any)?.personalInvestments ?? data.investments ?? [];
  const personalAccountIds = new Set(((data as any)?.personalAccounts ?? data.accounts ?? []).map((a: { id: string }) => a.id));
  const exchangeRate = (data as any).exchangeRate ?? 1;
  const zakatableHoldings: { holding: Holding; portfolioCurrency: 'USD' | 'SAR' }[] = [];

  investments.forEach((p: { currency?: string; holdings?: Holding[] }) => {
    const currency = (p.currency === 'SAR' ? 'SAR' : 'USD') as 'USD' | 'SAR';
    (p.holdings ?? []).forEach((h: Holding) => {
      if (h.zakahClass === 'Zakatable') {
        zakatableHoldings.push({ holding: h, portfolioCurrency: currency });
      }
    });
  });

  const bySymbol = new Map<string, { value: number; holding: Holding }>();
  zakatableHoldings.forEach(({ holding, portfolioCurrency }) => {
    const sym = (holding.symbol ?? '').toUpperCase();
    const valueSar = toSAR(holding.currentValue, portfolioCurrency, exchangeRate);
    const prev = bySymbol.get(sym);
    bySymbol.set(sym, {
      value: (prev?.value ?? 0) + valueSar,
      holding,
    });
  });

  const totalZakatable = Array.from(bySymbol.values()).reduce((sum, v) => sum + v.value, 0);
  if (totalZakatable <= 0) return { suggestions: [] };

  const suggestions: ZakatTradeSuggestion[] = [];

  const largePositions = Array.from(bySymbol.entries())
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 5);

  largePositions.forEach(([symbol, info]) => {
    const weightPct = (info.value / totalZakatable) * 100;
    if (weightPct >= 15) {
      suggestions.push({
        symbol,
        reason: 'Large zakatable position',
        impactDescription: `~${weightPct.toFixed(
          1
        )}% of your zakatable investments are in ${symbol}. Trimming before Zakat due date can crystallize gains and may simplify your calculation.`,
      });
    }
  });

  const allTxs = (data.investmentTransactions ?? []) as InvestmentTransaction[];
  const txs = personalAccountIds.size > 0 ? allTxs.filter(t => personalAccountIds.has(t.accountId ?? '')) : allTxs;
  const year = new Date().getFullYear();
  const recentBuys = txs.filter(t => {
    const d = new Date(t.date);
    return t.type === 'buy' && d.getFullYear() === year;
  });
  const byBuySymbol = new Map<string, { amount: number }>();
  recentBuys.forEach(t => {
    const sym = (t.symbol ?? '').toUpperCase();
    byBuySymbol.set(sym, { amount: (byBuySymbol.get(sym)?.amount ?? 0) + Math.abs(t.total) });
  });

  byBuySymbol.forEach((info, symbol) => {
    const pos = bySymbol.get(symbol);
    if (!pos) return;
    const buyShare = info.amount / pos.value;
    if (buyShare > 0.7) {
      suggestions.push({
        symbol,
        reason: 'Recently acquired position',
        impactDescription:
          'Most of this zakatable holding was bought this year. You may choose, with appropriate guidance, to base Zakat on the current value without complex historical tracking.',
      });
    }
  });

  return { suggestions };
}

