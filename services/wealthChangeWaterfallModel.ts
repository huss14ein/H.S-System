/** Waterfall bridge steps for Wealth Analytics overview. */
export type WealthWaterfallStep = {
  name: string;
  deltaSar: number;
  fill: string;
};

export function buildWealthChangeWaterfallSteps(args: {
  netWorthSar: number;
  monthlyPnLSar: number;
  buckets: { cash: number; investments: number; liabilities: number };
}): WealthWaterfallStep[] {
  const market = args.monthlyPnLSar * 0.65;
  const cashflow = args.monthlyPnLSar * 0.35;
  const prior = args.netWorthSar - args.monthlyPnLSar;
  return [
    { name: 'Prior', deltaSar: prior, fill: '#94a3b8' },
    { name: 'Market', deltaSar: market, fill: market >= 0 ? '#8b5cf6' : '#f43f5e' },
    { name: 'Cashflow', deltaSar: cashflow, fill: cashflow >= 0 ? '#10b981' : '#fb7185' },
    { name: 'Current', deltaSar: args.netWorthSar, fill: '#0ea5e9' },
  ];
}
