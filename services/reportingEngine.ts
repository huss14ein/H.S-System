/**
 * Reporting and export logic (logic layer).
 *
 * For now, these functions generate structured JSON/CSV strings.
 * UI/transport (PDF/Email) can be added in the automation/export layer.
 */

export interface MonthlyReportInput {
  periodLabel: string;
  netWorth: number;
  liquidNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyPnL: number;
  budgetVariance: number;
  roi: number;
}

export function generateMonthlyReport(input: MonthlyReportInput): string {
  const safe = (n: number) => (Number.isFinite(n) ? n : 0);
  const report = {
    type: 'monthly_report',
    period: input.periodLabel,
    netWorth: safe(input.netWorth),
    liquidNetWorth: safe(input.liquidNetWorth),
    monthlyIncome: safe(input.monthlyIncome),
    monthlyExpenses: safe(input.monthlyExpenses),
    monthlyPnL: safe(input.monthlyPnL),
    budgetVariance: safe(input.budgetVariance),
    roi: safe(input.roi),
  };
  return JSON.stringify(report, null, 2);
}

export function generateAnnualWealthSummary(args: {
  year: number;
  startNetWorth: number;
  endNetWorth: number;
  dividends?: number;
  interest?: number;
}): string {
  const growth = Math.max(0, (args.endNetWorth || 0) - (args.startNetWorth || 0));
  const summary = {
    type: 'annual_wealth_summary',
    year: args.year,
    startNetWorth: args.startNetWorth ?? 0,
    endNetWorth: args.endNetWorth ?? 0,
    growth,
    dividends: args.dividends ?? 0,
    interest: args.interest ?? 0,
  };
  return JSON.stringify(summary, null, 2);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    // Basic CSV escaping
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export function exportGoalStatus(args: {
  goals: { id: string; name: string; targetAmount: number; currentAmount: number; deadline: string }[];
}): string {
  return toCsv(
    args.goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount,
      currentAmount: g.currentAmount,
      deadline: g.deadline,
    }))
  );
}

export function exportPortfolioReview(args: {
  positions: { symbol: string; marketValue: number; avgCost: number; plPct?: number; sleeve?: string }[];
}): string {
  return toCsv(
    args.positions.map((p) => ({
      symbol: p.symbol,
      sleeve: p.sleeve ?? '',
      marketValue: p.marketValue,
      avgCost: p.avgCost,
      plPct: p.plPct ?? '',
    }))
  );
}

export interface WealthSummaryReportInput {
  generatedAtIso: string;
  currency: string;
  netWorth: number;
  netWorthTrendPct: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyPnL: number;
  savingsRatePct: number;
  debtToAssetRatioPct: number;
  emergencyFundMonths: number;
  emergencyFundTargetAmount: number;
  emergencyFundShortfall: number;
  liquidNetWorth: number;
  managedWealthTotal: number;
  riskLane: string;
  liquidityRunwayMonths: number;
  disciplineScore: number;
  investmentStyle: string;
  householdStressLabel: string;
  householdStressPressureMonths: number;
  shockDrillSeverity: string;
  shockDrillEstimatedGap: number;
  holdings: Array<{
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    currentValue: number;
    gainLoss: number;
    gainLossPct: number;
    currency: string;
    currentValueSar: number;
  }>;
}

export function generateWealthSummaryReportJson(input: WealthSummaryReportInput): string {
  const safe = (n: number) => (Number.isFinite(n) ? n : 0);
  return JSON.stringify(
    {
      type: 'wealth_summary_report',
      generatedAt: input.generatedAtIso,
      currency: input.currency,
      netWorth: safe(input.netWorth),
      netWorthTrendPct: safe(input.netWorthTrendPct),
      monthlyIncome: safe(input.monthlyIncome),
      monthlyExpenses: safe(input.monthlyExpenses),
      monthlyPnL: safe(input.monthlyPnL),
      savingsRatePct: safe(input.savingsRatePct),
      debtToAssetRatioPct: safe(input.debtToAssetRatioPct),
      emergencyFundMonths: safe(input.emergencyFundMonths),
      emergencyFundTargetAmount: safe(input.emergencyFundTargetAmount),
      emergencyFundShortfall: safe(input.emergencyFundShortfall),
      liquidNetWorth: safe(input.liquidNetWorth),
      managedWealthTotal: safe(input.managedWealthTotal),
      riskLane: input.riskLane,
      liquidityRunwayMonths: safe(input.liquidityRunwayMonths),
      disciplineScore: safe(input.disciplineScore),
      investmentStyle: input.investmentStyle,
      householdStressLabel: input.householdStressLabel,
      householdStressPressureMonths: safe(input.householdStressPressureMonths),
      shockDrillSeverity: input.shockDrillSeverity,
      shockDrillEstimatedGap: safe(input.shockDrillEstimatedGap),
      holdings: (input.holdings ?? []).map((h) => ({
        symbol: h.symbol,
        name: h.name,
        quantity: safe(h.quantity),
        avgCost: safe(h.avgCost),
        currentValue: safe(h.currentValue),
        gainLoss: safe(h.gainLoss),
        gainLossPct: safe(h.gainLossPct),
        currency: h.currency,
        currentValueSar: safe(h.currentValueSar),
      })),
    },
    null,
    2
  );
}

export function generateWealthSummaryReportCsv(input: WealthSummaryReportInput): string {
  const summaryRow = {
    rowType: 'summary',
    generatedAt: input.generatedAtIso,
    currency: input.currency,
    netWorth: input.netWorth,
    netWorthTrendPct: input.netWorthTrendPct,
    monthlyIncome: input.monthlyIncome,
    monthlyExpenses: input.monthlyExpenses,
    monthlyPnL: input.monthlyPnL,
    savingsRatePct: input.savingsRatePct,
    debtToAssetRatioPct: input.debtToAssetRatioPct,
    emergencyFundMonths: input.emergencyFundMonths,
    emergencyFundTargetAmount: input.emergencyFundTargetAmount,
    emergencyFundShortfall: input.emergencyFundShortfall,
    liquidNetWorth: input.liquidNetWorth,
    managedWealthTotal: input.managedWealthTotal,
    riskLane: input.riskLane,
    liquidityRunwayMonths: input.liquidityRunwayMonths,
    disciplineScore: input.disciplineScore,
    investmentStyle: input.investmentStyle,
    householdStressLabel: input.householdStressLabel,
    householdStressPressureMonths: input.householdStressPressureMonths,
    shockDrillSeverity: input.shockDrillSeverity,
    shockDrillEstimatedGap: input.shockDrillEstimatedGap,
    holdingSymbol: '',
    holdingName: '',
    holdingQuantity: '',
    holdingAvgCost: '',
    holdingCurrentValue: '',
    holdingGainLoss: '',
    holdingGainLossPct: '',
    holdingCurrency: '',
    holdingCurrentValueSar: '',
  };
  const holdingRows = (input.holdings ?? []).map((h) => ({
    rowType: 'holding',
    generatedAt: input.generatedAtIso,
    currency: input.currency,
    netWorth: '',
    netWorthTrendPct: '',
    monthlyIncome: '',
    monthlyExpenses: '',
    monthlyPnL: '',
    savingsRatePct: '',
    debtToAssetRatioPct: '',
    emergencyFundMonths: '',
    emergencyFundTargetAmount: '',
    emergencyFundShortfall: '',
    liquidNetWorth: '',
    managedWealthTotal: '',
    riskLane: '',
    liquidityRunwayMonths: '',
    disciplineScore: '',
    investmentStyle: '',
    householdStressLabel: '',
    householdStressPressureMonths: '',
    shockDrillSeverity: '',
    shockDrillEstimatedGap: '',
    holdingSymbol: h.symbol,
    holdingName: h.name,
    holdingQuantity: h.quantity,
    holdingAvgCost: h.avgCost,
    holdingCurrentValue: h.currentValue,
    holdingGainLoss: h.gainLoss,
    holdingGainLossPct: h.gainLossPct,
    holdingCurrency: h.currency,
    holdingCurrentValueSar: h.currentValueSar,
  }));
  return toCsv([
    summaryRow,
    ...holdingRows,
  ]);
}

export function generateWealthSummaryReportHtml(input: WealthSummaryReportInput): string {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const pct = (v: number) => `${n(v).toFixed(1)}%`;
  const num = (v: number) => n(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const money = (v: number) => `${input.currency} ${num(v)}`;
  const holdingsRows = (input.holdings ?? [])
    .map((h) => `<tr>
      <td>${h.symbol || ''}</td>
      <td>${h.name || ''}</td>
      <td style="text-align:right">${n(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
      <td style="text-align:right">${h.currency} ${num(h.avgCost)}</td>
      <td style="text-align:right">${h.currency} ${num(h.currentValue)}</td>
      <td style="text-align:right">${h.currency} ${num(h.gainLoss)}</td>
      <td style="text-align:right">${pct(h.gainLossPct)}</td>
      <td style="text-align:right">${money(h.currentValueSar)}</td>
    </tr>`)
    .join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Wealth Summary Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; margin: 28px; }
    .muted { color: #475569; }
    h1 { margin: 0 0 6px 0; font-size: 24px; }
    h2 { margin: 22px 0 8px 0; font-size: 16px; }
    .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .k { font-size: 12px; color: #64748b; margin-bottom: 3px; }
    .v { font-size: 18px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 7px; }
    th { background: #f8fafc; text-align: left; }
    .foot { margin-top: 18px; font-size: 12px; color: #64748b; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>Wealth Summary Report</h1>
  <div class="muted">Generated: ${new Date(input.generatedAtIso).toLocaleString()}</div>
  <div class="muted">Currency: ${input.currency}</div>

  <h2>Net Worth Snapshot</h2>
  <div class="grid">
    <div class="card"><div class="k">Net Worth</div><div class="v">${money(input.netWorth)}</div></div>
    <div class="card"><div class="k">Trend vs Last Month</div><div class="v">${pct(input.netWorthTrendPct)}</div></div>
    <div class="card"><div class="k">Liquid Net Worth</div><div class="v">${money(input.liquidNetWorth)}</div></div>
    <div class="card"><div class="k">Wealth Under Management</div><div class="v">${money(input.managedWealthTotal)}</div></div>
  </div>

  <h2>Cashflow & Efficiency (Current Month)</h2>
  <div class="grid">
    <div class="card"><div class="k">Income</div><div class="v">${money(input.monthlyIncome)}</div></div>
    <div class="card"><div class="k">Expenses</div><div class="v">${money(input.monthlyExpenses)}</div></div>
    <div class="card"><div class="k">Net P&L</div><div class="v">${money(input.monthlyPnL)}</div></div>
    <div class="card"><div class="k">Savings Rate</div><div class="v">${pct(input.savingsRatePct)}</div></div>
    <div class="card"><div class="k">Debt-to-Asset Ratio</div><div class="v">${pct(input.debtToAssetRatioPct)}</div></div>
    <div class="card"><div class="k">Investment Style</div><div class="v">${input.investmentStyle}</div></div>
  </div>

  <h2>Resilience & Risk</h2>
  <div class="grid">
    <div class="card"><div class="k">Emergency Fund Coverage</div><div class="v">${n(input.emergencyFundMonths).toFixed(1)} months</div></div>
    <div class="card"><div class="k">Emergency Fund Target</div><div class="v">${money(input.emergencyFundTargetAmount)}</div></div>
    <div class="card"><div class="k">Emergency Fund Shortfall</div><div class="v">${money(input.emergencyFundShortfall)}</div></div>
    <div class="card"><div class="k">Risk Lane</div><div class="v">${input.riskLane}</div></div>
    <div class="card"><div class="k">Liquidity Runway</div><div class="v">${n(input.liquidityRunwayMonths).toFixed(1)} months</div></div>
    <div class="card"><div class="k">Discipline Score</div><div class="v">${n(input.disciplineScore).toFixed(0)} / 100</div></div>
    <div class="card"><div class="k">Household Stress Status</div><div class="v">${input.householdStressLabel}</div></div>
    <div class="card"><div class="k">Household Stress Pressure Months</div><div class="v">${n(input.householdStressPressureMonths).toFixed(0)} month(s)</div></div>
    <div class="card"><div class="k">Shock Drill Severity</div><div class="v">${input.shockDrillSeverity}</div></div>
    <div class="card"><div class="k">Shock Drill Estimated Gap</div><div class="v">${money(input.shockDrillEstimatedGap)}</div></div>
  </div>

  <h2>Holding Details (Position by Position)</h2>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Name</th>
        <th>Quantity</th>
        <th>Avg Cost</th>
        <th>Current Value</th>
        <th>Gain/Loss</th>
        <th>Gain/Loss %</th>
        <th>Current Value (SAR)</th>
      </tr>
    </thead>
    <tbody>
      ${holdingsRows || '<tr><td colspan="8">No holdings found.</td></tr>'}
    </tbody>
  </table>

  <div class="foot">Prepared by Finova. This summary is informational and does not constitute financial advice.</div>
</body>
</html>`;
}

