export function deltaForInvestmentTrade(tradeType: string, total: number): number {
  const abs = Math.abs(Number(total) || 0);
  if (!Number.isFinite(abs) || abs === 0) return 0;
  if (tradeType === 'buy') return -abs;
  if (tradeType === 'sell') return abs;
  if (tradeType === 'deposit') return abs;
  if (tradeType === 'withdrawal') return -abs;
  if (tradeType === 'dividend') return abs;
  return 0;
}
