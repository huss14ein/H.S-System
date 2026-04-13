export function deltaForInvestmentTrade(tradeType: string, total: number): number {
  const abs = Math.abs(Number(total) || 0);
  if (!Number.isFinite(abs) || abs === 0) return 0;
  if (tradeType === 'buy') return -abs;
  if (tradeType === 'sell') return abs;
  if (tradeType === 'deposit') return abs;
  if (tradeType === 'withdrawal') return -abs;
  if (tradeType === 'dividend') return abs;
  if (tradeType === 'fee') return -abs;
  if (tradeType === 'vat') return -abs;
  return 0;
}

export function netInvestmentBalanceFromTransactions(
  accountId: string,
  transactions: Array<{ accountId?: string; type?: string; total?: number }>
): number {
  return (transactions ?? []).reduce((sum, tx) => {
    if ((tx.accountId ?? '') !== accountId) return sum;
    return sum + deltaForInvestmentTrade(String(tx.type ?? ''), Number(tx.total) || 0);
  }, 0);
}
