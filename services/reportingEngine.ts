/**
 * Reporting and export logic (logic layer).
 *
 * For now, these functions generate structured JSON/CSV strings.
 * UI/transport (PDF/Email) can be added in the automation/export layer.
 */

import type { WealthAnalyticsReportModel, WealthMetricPassportKey } from './wealthAnalyticsReportModel';
import { WEALTH_METRIC_PASSPORT_LABELS } from './wealthAnalyticsReportModel';
import {
  badgePrintClass,
  disciplineTone,
  runwayTone,
  signedValueTone,
  tonePrintClass,
} from './wealthReportPresentation';

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

/** Cash/bank transactions for CSV export (`Transaction` ledger rows only). */
export interface TransactionExportRow {
  id?: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  accountId: string;
  accountName?: string;
  budgetCategory?: string;
  subcategory?: string;
  type: string;
  transactionNature?: string;
  expenseType?: string;
  status?: string;
  transferGroupId?: string;
  transferRole?: string;
}

/**
 * Build CSV for filtered cash ledger rows (account + inclusive date period).
 */
export function exportCashTransactionsToCsv(rows: TransactionExportRow[]): string {
  if (!rows.length) return '';
  const normalized = rows.map((r) => ({
    date: String(r.date ?? ''),
    description: String(r.description ?? ''),
    amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : '',
    category: String(r.category ?? ''),
    budgetCategory: String(r.budgetCategory ?? ''),
    subcategory: String(r.subcategory ?? ''),
    type: String(r.type ?? ''),
    transactionNature: String(r.transactionNature ?? ''),
    expenseType: String(r.expenseType ?? ''),
    status: String(r.status ?? ''),
    accountId: String(r.accountId ?? ''),
    accountName: String(r.accountName ?? ''),
    transferGroupId: String(r.transferGroupId ?? ''),
    transferRole: String(r.transferRole ?? ''),
    id: String(r.id ?? ''),
  }));
  return toCsv(normalized as unknown as Record<string, unknown>[]);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function exportGoalStatus(args: {
  goals: {
    id: string;
    name: string;
    targetAmount: number;
    /** Stored ledger field (may omit linked wealth). */
    currentAmount: number;
    deadline: string;
    /** Optional: resolved toward goal (linked assets + investments + receivables), SAR — same basis as Goals page. */
    savedAmountResolvedSar?: number;
  }[];
}): string {
  return toCsv(
    args.goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount,
      currentAmountStored: g.currentAmount,
      savedAmountResolvedSar: g.savedAmountResolvedSar ?? '',
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
  /** Matches Summary “liquid wealth” breakdown (all SAR-normalized). */
  liquidBreakdown?: {
    liquidCash: number;
    portfolioHoldingsSar: number;
    sukukSar: number;
    investmentsSar: number;
    commodities: number;
    receivables: number;
    creditCardDebtSar: number;
    loanAndMortgageDebtSar: number;
    shortTermDebt: number;
    illiquidPhysicalAssetsSar: number;
  };
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
  assets?: Array<{
    name: string;
    type: string;
    value: number;
  }>;
  liabilities?: Array<{
    name: string;
    type: string;
    amount: number;
    status?: string;
  }>;
  investmentSummary?: {
    platformCount: number;
    portfolioCount: number;
    holdingCount: number;
    platformCashSar: number;
    holdingsValueSar: number;
  };
  platforms?: Array<{
    name: string;
    currency: string;
    cashSar: number;
    cashUsd: number;
    cashTotalSar: number;
  }>;
  portfolios?: Array<{
    name: string;
    platformName: string;
    currency: string;
    holdingsCount: number;
    holdingsValueSar: number;
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
      liquidBreakdown: input.liquidBreakdown
        ? {
            liquidCash: safe(input.liquidBreakdown.liquidCash),
            portfolioHoldingsSar: safe(input.liquidBreakdown.portfolioHoldingsSar),
            sukukSar: safe(input.liquidBreakdown.sukukSar),
            investmentsSar: safe(input.liquidBreakdown.investmentsSar),
            commodities: safe(input.liquidBreakdown.commodities),
            receivables: safe(input.liquidBreakdown.receivables),
            creditCardDebtSar: safe(input.liquidBreakdown.creditCardDebtSar),
            loanAndMortgageDebtSar: safe(input.liquidBreakdown.loanAndMortgageDebtSar),
            shortTermDebt: safe(input.liquidBreakdown.shortTermDebt),
            illiquidPhysicalAssetsSar: safe(input.liquidBreakdown.illiquidPhysicalAssetsSar),
          }
        : undefined,
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
      assets: (input.assets ?? []).map((a) => ({
        name: String(a.name ?? ''),
        type: String(a.type ?? ''),
        value: safe(a.value),
      })),
      liabilities: (input.liabilities ?? []).map((l) => ({
        name: String(l.name ?? ''),
        type: String(l.type ?? ''),
        amount: safe(l.amount),
        status: String(l.status ?? ''),
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

export function generateWealthSummaryReportHtml(
  input: WealthSummaryReportInput,
  options?: {
    includeSnapshot?: boolean;
    includeCashflow?: boolean;
    includeRisk?: boolean;
    includeInvestmentsOverview?: boolean;
    includePlatforms?: boolean;
    includePortfolios?: boolean;
    includeHoldings?: boolean;
    includeAssets?: boolean;
    includeLiabilities?: boolean;
  }
): string {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const pct = (v: number) => `${n(v).toFixed(1)}%`;
  const num = (v: number) => n(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const money = (v: number) => `${input.currency} ${num(v)}`;
  const cfg = {
    includeSnapshot: options?.includeSnapshot ?? true,
    includeCashflow: options?.includeCashflow ?? true,
    includeRisk: options?.includeRisk ?? true,
    includeInvestmentsOverview: options?.includeInvestmentsOverview ?? true,
    includePlatforms: options?.includePlatforms ?? true,
    includePortfolios: options?.includePortfolios ?? true,
    includeHoldings: options?.includeHoldings ?? true,
    includeAssets: options?.includeAssets ?? true,
    includeLiabilities: options?.includeLiabilities ?? true,
  };
  const platformRows = (input.platforms ?? [])
    .map((p) => `<tr>
      <td>${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.currency || '')}</td>
      <td style="text-align:right">SAR ${num(p.cashSar)}</td>
      <td style="text-align:right">USD ${num(p.cashUsd)}</td>
      <td style="text-align:right">${money(p.cashTotalSar)}</td>
    </tr>`)
    .join('');
  const portfolioRows = (input.portfolios ?? [])
    .map((p) => `<tr>
      <td>${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.platformName || '')}</td>
      <td>${escapeHtml(p.currency || '')}</td>
      <td style="text-align:right">${num(p.holdingsCount)}</td>
      <td style="text-align:right">${money(p.holdingsValueSar)}</td>
    </tr>`)
    .join('');
  const holdingsRows = (input.holdings ?? [])
    .map((h) => `<tr>
      <td>${escapeHtml(h.symbol || '')}</td>
      <td>${escapeHtml(h.name || '')}</td>
      <td style="text-align:right">${n(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
      <td style="text-align:right">${escapeHtml(h.currency)} ${num(h.avgCost)}</td>
      <td style="text-align:right">${escapeHtml(h.currency)} ${num(h.currentValue)}</td>
      <td style="text-align:right">${escapeHtml(h.currency)} ${num(h.gainLoss)}</td>
      <td style="text-align:right">${pct(h.gainLossPct)}</td>
      <td style="text-align:right">${money(h.currentValueSar)}</td>
    </tr>`)
    .join('');
  const assetsRows = (input.assets ?? [])
    .map((a) => `<tr>
      <td>${escapeHtml(a.name || '')}</td>
      <td>${escapeHtml(a.type || '')}</td>
      <td style="text-align:right">${money(a.value)}</td>
    </tr>`)
    .join('');
  const liabilitiesRows = (input.liabilities ?? [])
    .map((l) => `<tr>
      <td>${escapeHtml(l.name || '')}</td>
      <td>${escapeHtml(l.type || '')}</td>
      <td style="text-align:right">${money(l.amount)}</td>
      <td>${escapeHtml(l.status || '')}</td>
    </tr>`)
    .join('');
  const trendTone = (v: number): 'good' | 'bad' | 'neutral' => (v > 0 ? 'good' : v < 0 ? 'bad' : 'neutral');
  const savingsTone = (v: number): 'good' | 'warn' | 'bad' => (v >= 20 ? 'good' : v >= 10 ? 'warn' : 'bad');
  const runwayTone = (v: number): 'good' | 'warn' | 'bad' => (v >= 6 ? 'good' : v >= 3 ? 'warn' : 'bad');
  const toneClass = (tone: 'good' | 'warn' | 'bad' | 'neutral') => `tone-${tone}`;
  const metricCard = (label: string, value: string, tone: 'good' | 'warn' | 'bad' | 'neutral' = 'neutral') => `
    <article class="card ${toneClass(tone)}" role="listitem" aria-label="${escapeHtml(label)}">
      <div class="k">${escapeHtml(label)}</div>
      <div class="v">${escapeHtml(value)}</div>
    </article>
  `;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Wealth Summary Report</title>
  <style>
    :root { --bg:#f8fafc; --surface:#ffffff; --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --brand:#0ea5e9; --good:#16a34a; --warn:#d97706; --bad:#dc2626; --neutral:#334155; }
    * { box-sizing: border-box; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); margin: 0; background: linear-gradient(180deg,#f0f9ff 0%, var(--bg) 28%, var(--bg) 100%); }
    .container { max-width: 1160px; margin: 0 auto; padding: 24px; }
    .header { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; box-shadow: 0 8px 24px rgba(15,23,42,.05); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 10px; background:#fff; }
    .chip::before { content:''; width:7px; height:7px; border-radius:999px; background:var(--brand); }
    .muted { color: var(--muted); }
    h1 { margin: 0; font-size: clamp(1.25rem, 2.4vw, 1.7rem); letter-spacing: .01em; }
    h2 { margin: 24px 0 10px 0; font-size: 16px; letter-spacing: .01em; }
    .section { margin-top: 14px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
    .card { border: 1px solid var(--line); border-left: 5px solid var(--neutral); border-radius: 12px; padding: 12px; background: var(--surface); min-height: 78px; }
    .k { font-size: 12px; color: var(--muted); margin-bottom: 4px; line-height: 1.3; }
    .v { font-size: 19px; font-weight: 700; line-height: 1.25; }
    .tone-good { border-left-color: var(--good); }
    .tone-warn { border-left-color: var(--warn); }
    .tone-bad { border-left-color: var(--bad); }
    .tone-neutral { border-left-color: var(--neutral); }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
    table { width: 100%; border-collapse: collapse; margin-top: 0; font-size: 12px; min-width: 680px; }
    th, td { border-bottom: 1px solid var(--line); padding: 9px 8px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; font-weight: 700; font-size: 12px; letter-spacing: .01em; }
    tr:nth-child(even) td { background: #fcfdff; }
    .foot { margin-top: 18px; font-size: 12px; color: var(--muted); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .container { padding: 14px; } }
    @media print { body { background: #fff; } .container { padding: 12px; max-width: none; } .header { box-shadow:none; } }
  </style>
</head>
<body>
  <main class="container" aria-label="Wealth summary report">
  <header class="header">
    <h1>Wealth Summary Report</h1>
    <div class="meta">
      <span class="chip">Generated: ${new Date(input.generatedAtIso).toLocaleString()}</span>
      <span class="chip">Currency: ${escapeHtml(input.currency)}</span>
    </div>
  </header>

  ${cfg.includeSnapshot ? `<section class="section"><h2>Net Worth Snapshot</h2>
  <div class="grid" role="list">
    ${metricCard('Net Worth', money(input.netWorth), trendTone(input.netWorthTrendPct))}
    ${metricCard('Trend vs Last Month', pct(input.netWorthTrendPct), trendTone(input.netWorthTrendPct))}
    ${metricCard('Liquid Net Worth', money(input.liquidNetWorth), 'neutral')}
    ${metricCard('Wealth Under Management', money(input.managedWealthTotal), 'neutral')}
  </div></section>` : ''}

  ${cfg.includeCashflow ? `<section class="section"><h2>Cashflow & Efficiency (Current Month)</h2>
  <div class="grid" role="list">
    ${metricCard('Income', money(input.monthlyIncome), 'good')}
    ${metricCard('Expenses', money(input.monthlyExpenses), 'warn')}
    ${metricCard('Net P&L', money(input.monthlyPnL), trendTone(input.monthlyPnL))}
    ${metricCard('Savings Rate', pct(input.savingsRatePct), savingsTone(input.savingsRatePct))}
    ${metricCard('Debt-to-Asset Ratio', pct(input.debtToAssetRatioPct), input.debtToAssetRatioPct > 40 ? 'bad' : input.debtToAssetRatioPct > 20 ? 'warn' : 'good')}
    ${metricCard('Investment Style', escapeHtml(input.investmentStyle), 'neutral')}
  </div></section>` : ''}

  ${cfg.includeRisk ? `<section class="section"><h2>Resilience & Risk</h2>
  <div class="grid" role="list">
    ${metricCard('Emergency Fund Coverage', `${n(input.emergencyFundMonths).toFixed(1)} months`, runwayTone(input.emergencyFundMonths))}
    <div class="card"><div class="k">Emergency Fund Target</div><div class="v">${money(input.emergencyFundTargetAmount)}</div></div>
    <div class="card"><div class="k">Emergency Fund Shortfall</div><div class="v">${money(input.emergencyFundShortfall)}</div></div>
    <div class="card"><div class="k">Risk Lane</div><div class="v">${escapeHtml(input.riskLane)}</div></div>
    ${metricCard('Liquidity Runway', `${n(input.liquidityRunwayMonths).toFixed(1)} months`, runwayTone(input.liquidityRunwayMonths))}
    <div class="card"><div class="k">Discipline Score</div><div class="v">${n(input.disciplineScore).toFixed(0)} / 100</div></div>
    <div class="card"><div class="k">Household Stress Status</div><div class="v">${escapeHtml(input.householdStressLabel)}</div></div>
    <div class="card"><div class="k">Household Stress Pressure Months</div><div class="v">${n(input.householdStressPressureMonths).toFixed(0)} month(s)</div></div>
    <div class="card"><div class="k">Shock Drill Severity</div><div class="v">${escapeHtml(input.shockDrillSeverity)}</div></div>
    <div class="card"><div class="k">Shock Drill Estimated Gap</div><div class="v">${money(input.shockDrillEstimatedGap)}</div></div>
  </div></section>` : ''}

  ${cfg.includeInvestmentsOverview ? `<h2>Investment Summary</h2>
  <div class="grid">
    <div class="card"><div class="k">Platforms</div><div class="v">${num(input.investmentSummary?.platformCount ?? 0)}</div></div>
    <div class="card"><div class="k">Portfolios</div><div class="v">${num(input.investmentSummary?.portfolioCount ?? 0)}</div></div>
    <div class="card"><div class="k">Holdings</div><div class="v">${num(input.investmentSummary?.holdingCount ?? 0)}</div></div>
    <div class="card"><div class="k">Platform Cash (SAR)</div><div class="v">${money(input.investmentSummary?.platformCashSar ?? 0)}</div></div>
    <div class="card"><div class="k">Holdings Value (SAR)</div><div class="v">${money(input.investmentSummary?.holdingsValueSar ?? 0)}</div></div>
  </div>` : ''}

  ${cfg.includePlatforms ? `<section class="section"><h2>Investment Platforms</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Platform</th><th>Currency</th><th>Cash (SAR)</th><th>Cash (USD)</th><th>Total Cash (SAR)</th></tr></thead>
    <tbody>${platformRows || '<tr><td colspan="5" class="muted">No platform cash rows.</td></tr>'}</tbody>
  </table></div></section>` : ''}

  ${cfg.includePortfolios ? `<section class="section"><h2>Investment Portfolios</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Portfolio</th><th>Platform</th><th>Currency</th><th>Holdings</th><th>Value (SAR)</th></tr></thead>
    <tbody>${portfolioRows || '<tr><td colspan="5" class="muted">No portfolios.</td></tr>'}</tbody>
  </table></div></section>` : ''}

  ${cfg.includeHoldings ? `<section class="section"><h2>Holding Details (Position by Position)</h2>
  <div class="table-wrap"><table>
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
  </table></div></section>` : ''}

  ${cfg.includeAssets ? `<section class="section"><h2>Asset Details</h2>
  <div class="table-wrap"><table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Value</th>
      </tr>
    </thead>
    <tbody>
      ${assetsRows || '<tr><td colspan="3">No assets found.</td></tr>'}
    </tbody>
  </table></div></section>` : ''}

  ${cfg.includeLiabilities ? `<section class="section"><h2>Liability Details</h2>
  <div class="table-wrap"><table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Amount</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${liabilitiesRows || '<tr><td colspan="4">No liabilities found.</td></tr>'}
    </tbody>
  </table></div></section>` : ''}

  <div class="foot">Prepared by Finova. This summary is informational and does not constitute financial advice.</div>
  </main>
</body>
</html>`;
}

const WEALTH_PRINT_STYLES = `
    :root { --bg:#f8fafc; --surface:#ffffff; --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --brand:#6366f1; --good:#16a34a; --warn:#d97706; --bad:#dc2626; --neutral:#64748b; }
    * { box-sizing: border-box; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); margin: 0; background: linear-gradient(180deg,#eef2ff 0%, var(--bg) 28%, var(--bg) 100%); }
    .container { max-width: 1160px; margin: 0 auto; padding: 24px; }
    .header { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; box-shadow: 0 8px 24px rgba(15,23,42,.05); }
    .hero { margin-top: 14px; border-radius: 16px; padding: 18px 20px; background: linear-gradient(135deg,#eef2ff 0%,#ffffff 55%,#ecfeff 100%); border: 1px solid #c7d2fe; }
    .hero-k { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #4338ca; margin: 0; }
    .hero-v { font-size: clamp(1.75rem, 3vw, 2.25rem); font-weight: 800; margin: 6px 0 0 0; line-height: 1.15; }
    .hero-sub { font-size: 13px; color: var(--muted); margin: 6px 0 0 0; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 10px; background:#fff; }
    .chip.live::before { content:''; width:7px; height:7px; border-radius:999px; background:var(--good); }
    .chip.warn::before { content:''; width:7px; height:7px; border-radius:999px; background:var(--warn); }
    h1 { margin: 0; font-size: clamp(1.25rem, 2.4vw, 1.7rem); }
    h2 { margin: 20px 0 10px 0; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #4338ca; }
    h3 { margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: var(--ink); }
    .section { margin-top: 14px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
    .card { border: 1px solid var(--line); border-left: 5px solid var(--neutral); border-radius: 12px; padding: 12px; background: var(--surface); min-height: 88px; box-shadow: 0 2px 8px rgba(15,23,42,.04); }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .k { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    .v { font-size: 20px; font-weight: 700; line-height: 1.25; }
    .v.positive { color: #15803d; }
    .v.negative { color: #b91c1c; }
    .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .badge { display:inline-block; font-size:10px; font-weight:800; padding:3px 9px; border-radius:999px; letter-spacing:.02em; white-space: nowrap; }
    .badge-good { background:#dcfce7; color:#166534; border:1px solid #86efac; }
    .badge-warn { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
    .badge-bad { background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; }
    .badge-neutral { background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; }
    .tone-good { border-left-color: var(--good); background: linear-gradient(90deg,#f0fdf4 0%,#fff 28%); }
    .tone-warn { border-left-color: var(--warn); background: linear-gradient(90deg,#fffbeb 0%,#fff 28%); }
    .tone-bad { border-left-color: var(--bad); background: linear-gradient(90deg,#fef2f2 0%,#fff 28%); }
    .tone-neutral { border-left-color: var(--neutral); }
    .passport-block { border:1px solid var(--line); border-left:5px solid var(--brand); border-radius:12px; padding:14px; background:#fff; margin-top:10px; }
    .passport-block.tone-good { border-left-color: var(--good); }
    .passport-block.tone-warn { border-left-color: var(--warn); }
    .passport-block.tone-bad { border-left-color: var(--bad); }
    .spark-wrap { margin-top: 8px; }
    .spark { font-size:11px; color:var(--muted); font-family: ui-monospace, monospace; word-break: break-all; margin-top: 8px; }
    .summary-row { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; }
    .summary-pill { flex:1; min-width:140px; border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:#fff; }
    .summary-pill .k { margin-bottom:2px; }
    .foot { margin-top: 18px; font-size: 12px; color: var(--muted); border-top:1px solid var(--line); padding-top:12px; }
    @media (max-width: 900px) { .grid, .grid-2, .grid-3 { grid-template-columns: 1fr; } .container { padding: 14px; } }
    @media print { body { background: #fff; } .container { padding: 12px; max-width: none; } .header, .hero { box-shadow:none; } .card { break-inside: avoid; } }
`;

function wealthMetricCard(kpi: WealthAnalyticsReportModel['executiveKpis'][number]): string {
  const tone = kpi.tone ?? 'neutral';
  const accent = kpi.accentColor ?? '#6366f1';
  return `<article class="card ${tonePrintClass(tone)}" style="border-left-color:${accent}">
    <div class="card-head">
      <div class="k">${escapeHtml(kpi.label)}</div>
      <span class="${badgePrintClass(tone)}">${escapeHtml(kpi.statusLabel)}</span>
    </div>
    <div class="v">${escapeHtml(kpi.valueDisplay)}</div>
    <div class="sub">${kpi.targetDisplay ? `Target ${escapeHtml(kpi.targetDisplay)}` : '&nbsp;'}</div>
    ${kpi.sparkline.length >= 2 ? `<div class="spark-wrap">${sparklineSvg(kpi.sparkline, accent)}</div>` : ''}
  </article>`;
}

function pnlCard(label: string, valueSar: number, series: number[], stroke: string): string {
  const tone = signedValueTone(valueSar);
  const money = `SAR ${(Number.isFinite(valueSar) ? valueSar : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const valueClass = tone === 'good' ? 'positive' : tone === 'bad' ? 'negative' : '';
  const status = tone === 'good' ? 'Gain' : tone === 'bad' ? 'Loss' : 'Neutral';
  return `<article class="card ${tonePrintClass(tone)}">
    <div class="card-head">
      <div class="k">${escapeHtml(label)}</div>
      <span class="${badgePrintClass(tone)}">${status}</span>
    </div>
    <div class="v ${valueClass}">${money}</div>
    ${series.length >= 2 ? `<div class="spark-wrap">${sparklineSvg(series, stroke)}</div>` : ''}
  </article>`;
}

function healthCard(label: string, valueDisplay: string, tone: 'good' | 'warn' | 'bad' | 'neutral', status: string): string {
  return `<article class="card ${tonePrintClass(tone)}">
    <div class="card-head">
      <div class="k">${escapeHtml(label)}</div>
      <span class="${badgePrintClass(tone)}">${escapeHtml(status)}</span>
    </div>
    <div class="v">${escapeHtml(valueDisplay)}</div>
  </article>`;
}

function sparklineText(values: number[]): string {
  if (!values.length) return '—';
  return values.map((v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '—')).join(' → ');
}

function sparklineSvg(values: number[], stroke = '#6366f1', height = 48, width = 220): string {
  if (!values.length) return '<span class="sub">—</span>';
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return `<span class="sub">${escapeHtml(sparklineText(values))}</span>`;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const pts = finite
    .map((v, i) => {
      const x = (i / (finite.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline fill="none" stroke="${stroke}" stroke-width="2.5" points="${pts}"/></svg>`;
}

function quoteChip(model: WealthAnalyticsReportModel): string {
  if (model.quotesAsOfIso) {
    const when = new Date(model.quotesAsOfIso).toLocaleString();
    return `<span class="chip live">Quotes as of ${escapeHtml(when)}</span>`;
  }
  return `<span class="chip warn">${model.quotesLive ? 'Live quotes' : 'Cached quotes'}</span>`;
}

/** One-page executive KPI grid for Wealth Analytics PDF export. */
export function generateWealthExecutiveSummaryHtml(model: WealthAnalyticsReportModel): string {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const money = (v: number) => `SAR ${n(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const netWorthKpi = model.executiveKpis.find((k) => k.key === 'netWorth');
  const roiKpi = model.executiveKpis.find((k) => k.key === 'investmentRoi');
  const disciplineT = disciplineTone(n(model.disciplineScore));
  const runwayT = runwayTone(n(model.liquidityRunwayMonths));
  const disciplineStatus = disciplineT === 'good' ? 'On track' : disciplineT === 'warn' ? 'Watch' : disciplineT === 'bad' ? 'At risk' : 'Neutral';
  const runwayStatus = runwayT === 'good' ? 'Funded' : runwayT === 'warn' ? 'Building' : runwayT === 'bad' ? 'Gap' : 'Neutral';

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Wealth Analytics — Executive Summary</title><style>${WEALTH_PRINT_STYLES}</style></head>
<body><main class="container">
  <header class="header">
    <h1>Wealth Analytics — Executive Summary</h1>
    <div class="meta">
      <span class="chip">Generated ${escapeHtml(new Date(model.generatedAtIso).toLocaleString())}</span>
      <span class="chip">FX ${escapeHtml(model.sarPerUsd.toFixed(4))} SAR/USD</span>
      ${quoteChip(model)}
    </div>
  </header>
  <section class="hero" aria-label="Headline net worth">
    <p class="hero-k">Total net worth</p>
    <p class="hero-v">${escapeHtml(netWorthKpi?.valueDisplay ?? money(model.base.netWorth))}</p>
    <p class="hero-sub">Investments ${money(model.investmentsTotalSar)} · Liquid cash ${money(model.liquidCashSar)} · ROI ${escapeHtml(roiKpi?.valueDisplay ?? `${(n(model.investmentRoiPct) * 100).toFixed(1)}%`)}</p>
  </section>
  <section class="section"><h2>Headline KPIs</h2>
    <div class="grid">${model.executiveKpis.map(wealthMetricCard).join('')}</div>
  </section>
  <section class="section"><h2>Portfolio P/L (live quotes)</h2>
    <div class="grid-2">
      ${pnlCard('Week P/L', model.weeklyPnLTotalSar, model.weeklyPnLCumulative, '#06b6d4')}
      ${pnlCard('Month P/L', model.monthlyPnLTotalSar, model.monthlyPnLCumulative, '#0ea5e9')}
    </div>
  </section>
  <section class="section"><h2>Wealth health indicators</h2>
    <div class="grid-2">
      ${healthCard('Discipline score', `${n(model.disciplineScore).toFixed(0)}/100`, disciplineT, disciplineStatus)}
      ${healthCard('Liquidity runway', `${n(model.liquidityRunwayMonths).toFixed(1)} mo`, runwayT, runwayStatus)}
    </div>
    <div class="summary-row">
      <div class="summary-pill"><div class="k">Budget variance</div><div class="v">${money(model.budgetVariance)}</div></div>
      <div class="summary-pill"><div class="k">Investment exposure</div><div class="v">${money(model.investmentsTotalSar)}</div></div>
      <div class="summary-pill"><div class="k">Liquid cash</div><div class="v">${money(model.liquidCashSar)}</div></div>
    </div>
  </section>
  <div class="foot">Numbers match on-screen Wealth Analytics (canonical KPI engine + live investment quotes). Prepared by Finova.</div>
</main></body></html>`;
}

/** Per-metric passport — sections A (headline), B (trend), C (context). */
export function generateWealthMetricPassportHtml(
  model: WealthAnalyticsReportModel,
  metric: WealthMetricPassportKey,
): string {
  const title = WEALTH_METRIC_PASSPORT_LABELS[metric];
  const kpi = model.executiveKpis.find((k) => k.key === metric);
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const money = (v: number) => `SAR ${n(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  let sectionC = '';
  if (metric === 'netWorth') {
    sectionC = `Headline balance sheet net worth from computePersonalHeadlineNetWorthSar. Investments total ${money(model.investmentsTotalSar)}. Liquid cash ${money(model.liquidCashSar)}.`;
  } else if (metric === 'monthlyPnL') {
    sectionC = `Financial-month income minus expenses (transaction-dated FX). Portfolio week P/L ${money(model.weeklyPnLTotalSar)}; month P/L ${money(model.monthlyPnLTotalSar)} (mark-to-market from period start).`;
  } else if (metric === 'investmentRoi') {
    sectionC = `Platform rollup + commodities + Sukuk vs net capital (computeHeadlinePersonalInvestmentRoiDecimal). Total exposure ${money(model.investmentsTotalSar)}.`;
  } else if (metric === 'budgetVariance') {
    sectionC = 'Positive = under budget this financial month. Same path as Dashboard KPI row.';
  } else {
    sectionC = `Target ${model.executiveKpis.find((k) => k.key === 'emergencyFund')?.targetDisplay ?? '6 mo'}. Liquid cash ${money(model.liquidCashSar)}.`;
  }

  const pnlSeries = metric === 'monthlyPnL' ? model.monthlyPnLCumulative : kpi?.sparkline ?? [];
  const tone = kpi?.tone ?? 'neutral';
  const accent = kpi?.accentColor ?? '#6366f1';

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)} — Metric Passport</title><style>${WEALTH_PRINT_STYLES}</style></head>
<body><main class="container">
  <header class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span class="chip">Wealth Analytics passport</span>
      <span class="chip">${escapeHtml(new Date(model.generatedAtIso).toLocaleString())}</span>
      ${quoteChip(model)}
    </div>
  </header>
  <section class="passport-block ${tonePrintClass(tone)}" style="border-left-color:${accent}">
    <h3>A — Current reading</h3>
    <div class="card-head">
      <div class="v">${escapeHtml(kpi?.valueDisplay ?? '—')}</div>
      <span class="${badgePrintClass(tone)}">${escapeHtml(kpi?.statusLabel ?? '')}</span>
    </div>
    <p class="sub">${kpi?.targetDisplay ? `Target ${escapeHtml(kpi.targetDisplay)}` : 'No target set'}</p>
  </section>
  <section class="passport-block">
    <h3>B — Trend series</h3>
    ${pnlSeries.length >= 2 ? `<div class="spark-wrap">${sparklineSvg(pnlSeries, accent, 56, 280)}</div>` : ''}
    <p class="spark">${escapeHtml(sparklineText(pnlSeries))}</p>
  </section>
  <section class="passport-block">
    <h3>C — Definition &amp; reconciliation</h3>
    <p class="sub">${escapeHtml(sectionC)}</p>
    <p class="sub">FX ${escapeHtml(model.sarPerUsd.toFixed(4))} SAR/USD · Base report net worth ${money(model.base.netWorth)}</p>
  </section>
  <div class="foot">Metric passport — same canonical numbers as the live Wealth Analytics page.</div>
</main></body></html>`;
}

/**
 * Print a full HTML document. Prefers an in-page iframe so it does not depend on pop-ups.
 * Fallback opens a new window **without** `noopener` — with `noopener`, Chromium/Firefox often
 * return `null` from `window.open` (misread as “blocked”) even when pop-ups are allowed.
 */
export function openHtmlForPrint(html: string): boolean {
  if (typeof document === 'undefined') return false;

  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Print preview');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument;
    const iwin = iframe.contentWindow;
    if (!idoc || !iwin) {
      iframe.remove();
      return openHtmlForPrintInNewWindow(html);
    }

    idoc.open();
    idoc.write(html);
    idoc.close();

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    };

    const runPrint = () => {
      try {
        iwin.focus();
        iwin.print();
      } catch {
        cleanup();
      }
    };

    iwin.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(() => {
      runPrint();
      window.setTimeout(cleanup, 10_000);
    }, 150);

    return true;
  } catch {
    return openHtmlForPrintInNewWindow(html);
  }
}

function openHtmlForPrintInNewWindow(html: string): boolean {
  const w = window.open('', '_blank', 'width=980,height=760,scrollbars=yes');
  if (!w) return false;
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
  } catch {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    return false;
  }
  window.setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  }, 150);
  return true;
}
