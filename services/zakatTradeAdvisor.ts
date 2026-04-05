import type { FinancialData, InvestmentTransaction } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { summarizeZakatableInvestmentsForZakat } from './zakatInvestmentValuation';

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

  const investments = getPersonalInvestments(data);
  const personalAccounts = getPersonalAccounts(data);
  const personalAccountIds = new Set(personalAccounts.map((a) => a.id));
  const sarPerUsd = resolveSarPerUsd(data, undefined);
  const txs = (data.investmentTransactions ?? []) as InvestmentTransaction[];
  const { lines } = summarizeZakatableInvestmentsForZakat(investments, sarPerUsd, txs);

  const bySymbol = new Map<string, number>();
  for (const row of lines) {
    const sym = row.symbol.toUpperCase();
    bySymbol.set(sym, (bySymbol.get(sym) ?? 0) + row.zakatableValueSar);
  }

  const totalZakatable = Array.from(bySymbol.values()).reduce((sum, v) => sum + v, 0);
  if (totalZakatable <= 0) return { suggestions: [] };

  const suggestions: ZakatTradeSuggestion[] = [];

  const largePositions = Array.from(bySymbol.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  largePositions.forEach(([symbol, value]) => {
    const weightPct = (value / totalZakatable) * 100;
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
  const txsFiltered = personalAccountIds.size > 0
    ? allTxs.filter((t) => personalAccountIds.has(resolveInvestmentTransactionAccountId(t as any, personalAccounts as any, investments as any)))
    : allTxs;
  const year = new Date().getFullYear();
  const recentBuys = txsFiltered.filter(t => {
    const d = new Date(t.date);
    return t.type === 'buy' && d.getFullYear() === year;
  });
  const byBuySymbol = new Map<string, { amount: number }>();
  recentBuys.forEach(t => {
    const sym = (t.symbol ?? '').toUpperCase();
    byBuySymbol.set(sym, { amount: (byBuySymbol.get(sym)?.amount ?? 0) + Math.abs(getInvestmentTransactionCashAmount(t as any)) });
  });

  byBuySymbol.forEach((info, symbol) => {
    const posValue = bySymbol.get(symbol);
    if (!posValue) return;
    const buyShare = info.amount / posValue;
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
