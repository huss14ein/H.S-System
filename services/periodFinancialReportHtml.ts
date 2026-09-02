/**
 * Period Financial Report HTML (print → Save as PDF).
 */
import type { PeriodFinancialReportModel } from './periodFinancialReportModel';
import { exportCashTransactionsToCsv } from './reportingEngine';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-SA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${fmt(n, 0)} SAR`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function svgBars(
  values: number[],
  labels: string[],
  width = 640,
  height = 160,
  color = '#0ea5e9',
): string {
  if (!values.length) return '<p class="muted">No chart data.</p>';
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const gap = 4;
  const barW = Math.max(4, (width - gap * (values.length + 1)) / values.length);
  const mid = height / 2;
  const bars = values
    .map((v, i) => {
      const h = (Math.abs(v) / max) * (height * 0.42);
      const x = gap + i * (barW + gap);
      const y = v >= 0 ? mid - h : mid;
      const fill = v >= 0 ? color : '#ef4444';
      const label = labels[i] ? esc(labels[i]!.slice(0, 8)) : '';
      return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(1, h)}" fill="${fill}"/><text x="${x + barW / 2}" y="${height - 4}" text-anchor="middle" font-size="8" fill="#64748b">${label}</text>`;
    })
    .join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><line x1="0" y1="${mid}" x2="${width}" y2="${mid}" stroke="#e2e8f0"/>${bars}</svg>`;
}

function svgPie(
  slices: { label: string; valueSar: number }[],
  size = 180,
): string {
  const total = slices.reduce((s, x) => s + Math.max(0, x.valueSar), 0);
  if (!(total > 0)) return '<p class="muted">No allocation data.</p>';
  const colors = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#14b8a6'];
  let angle = -Math.PI / 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.4;
  const paths: string[] = [];
  slices.forEach((sl, i) => {
    const frac = Math.max(0, sl.valueSar) / total;
    const a2 = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    paths.push(
      `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[i % colors.length]}"/>`,
    );
    angle = a2;
  });
  const legend = slices
    .map(
      (s, i) =>
        `<li><span class="swatch" style="background:${colors[i % colors.length]}"></span>${esc(s.label)} · ${money(s.valueSar)}</li>`,
    )
    .join('');
  return `<div class="pie-wrap"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths.join('')}</svg><ul class="legend">${legend}</ul></div>`;
}

function section(id: string, title: string, body: string): string {
  return `<section id="${esc(id)}" class="section"><h2>${esc(title)}</h2>${body}</section>`;
}

export function generatePeriodFinancialReportHtml(model: PeriodFinancialReportModel): string {
  const { cover, wealth, cashflow, budgets, transactions, investments, sukukCommodities, debt, safety, goalsPlan, zakatInsurance, dataQuality, recommendations } = model;

  const nwBars = svgBars(
    [wealth.startNwSar ?? 0, wealth.endNwSar],
    ['Start', 'End'],
    320,
    120,
    '#0369a1',
  );
  const netBars = svgBars(
    cashflow.months.map((m) => m.net),
    cashflow.months.map((m) => m.label),
    640,
    160,
  );
  const incomeExpense = svgBars(
    cashflow.months.flatMap((m) => [m.inflow, -m.outflow]),
    cashflow.months.flatMap((m) => [`${m.label} in`, `${m.label} out`]),
    640,
    160,
    '#10b981',
  );
  const budgetBars = svgBars(
    budgets.categories.slice(0, 12).map((c) => c.utilizationPct),
    budgets.categories.slice(0, 12).map((c) => c.category),
    640,
    160,
    '#8b5cf6',
  );
  const pie = svgPie(investments.allocation.slice(0, 8));
  const portBars = svgBars(
    investments.portfolioPeriodPnL.map((p) => p.totalSar),
    investments.portfolioPeriodPnL.map((p) => p.portfolioName),
    640,
    160,
    '#0ea5e9',
  );
  const debtBars = debt.liabilities.length
    ? svgBars(
        debt.liabilities.map((l) => l.balanceSar),
        debt.liabilities.map((l) => l.name),
        640,
        140,
        '#ef4444',
      )
    : '<p class="muted">No liabilities.</p>';
  const goalBars = goalsPlan.goals.length
    ? svgBars(
        goalsPlan.goals.map((g) => g.progressPct),
        goalsPlan.goals.map((g) => g.name),
        640,
        140,
        '#10b981',
      )
    : '<p class="muted">No goals.</p>';

  const txAppendix = transactions.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td>${esc(r.category)}</td><td>${esc(r.accountName)}</td><td class="num">${fmt(r.amount, 2)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Period Financial Report — ${esc(cover.periodLabel)}</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#fff; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink); margin: 0; background: var(--bg); }
  .page { max-width: 920px; margin: 0 auto; padding: 28px 24px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 0 0 12px; border-bottom: 2px solid var(--line); padding-bottom: 6px; }
  h3 { font-size: 0.95rem; margin: 16px 0 8px; color: #334155; }
  .muted { color: var(--muted); font-size: 0.85rem; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 12px 0 20px; }
  .meta div { background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .meta strong { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .section { break-inside: avoid; page-break-inside: avoid; margin: 28px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 4px; text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
  .kpi { font-size: 1.25rem; font-weight: 700; }
  .pie-wrap { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .legend { list-style: none; padding: 0; margin: 0; font-size: 0.8rem; }
  .legend li { margin: 4px 0; display: flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .rec { border-left: 3px solid #0ea5e9; padding: 8px 10px; margin: 8px 0; background: #f8fafc; }
  .rec.high { border-color: #ef4444; }
  .rec.medium { border-color: #f59e0b; }
  .warn { color: #b45309; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .section { page-break-inside: avoid; }
    #report-transactions { page-break-before: always; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>Period Financial Report</h1>
    <p class="muted">${esc(cover.periodLabel)} · Generated ${esc(model.generatedAtIso.slice(0, 19).replace('T', ' '))} UTC</p>
    <div class="meta">
      <div><strong>Net worth (end)</strong><span class="kpi">${money(wealth.endNwSar)}</span></div>
      <div><strong>Period Δ NW</strong><span class="kpi">${money(wealth.deltaSar)}</span></div>
      <div><strong>FX SAR/USD</strong><span class="kpi">${fmt(cover.sarPerUsd, 4)}</span></div>
      <div><strong>Quotes</strong><span>${esc(cover.quotesAsOf ?? 'n/a')}</span></div>
      <div><strong>Data quality</strong><span>${esc(cover.integritySeverity)}${cover.staleQuotes ? ' · stale quotes' : ''}</span></div>
    </div>
    <p class="muted">${esc(cover.taxDisclaimer)}</p>
  </header>

  ${section(
    'report-wealth',
    '1. Wealth & growth',
    `<div class="grid2"><div>${nwBars}</div><div>
      <p>Start: <strong>${money(wealth.startNwSar)}</strong>${wealth.startSnapshotFallback ? ' <span class="warn">(snapshot fallback)</span>' : ''}</p>
      <p>End: <strong>${money(wealth.endNwSar)}</strong></p>
      <p>Δ: <strong>${money(wealth.deltaSar)}</strong> (${pct(wealth.deltaPct)})</p>
      <p>Prior-period Δ: <strong>${money(wealth.priorDeltaSar)}</strong></p>
      <p>Liquid NW: ${money(wealth.liquidNetWorthSar)} · Liquid cash: ${money(wealth.liquidCashSar)}</p>
      <p>Tradable broker cash: ${money(wealth.tradableBrokerCashSar)}</p>
      <p>Available liquidity: ${money(wealth.availableLiquiditySar)} · EF floor: ${money(wealth.emergencyFundFloorSar)} · Goal reserves: ${money(wealth.reservedLiquiditySar)}</p>
      <p>Buckets — cash ${money(wealth.buckets.cash)}, investments ${money(wealth.buckets.investments)}, physical ${money(wealth.buckets.physical)}, liabilities ${money(wealth.buckets.liabilities)}</p>
    </div></div>`,
  )}

  ${section(
    'report-cashflow',
    '2. Cashflow & monthly savings',
    `<h3>Net savings by month</h3>${netBars}
     <h3>Income vs expense</h3>${incomeExpense}
     <table><thead><tr><th>Month</th><th class="num">Inflow</th><th class="num">Outflow</th><th class="num">Net</th><th class="num">Savings %</th></tr></thead>
     <tbody>${cashflow.months
       .map(
         (m) =>
           `<tr><td>${esc(m.label)}</td><td class="num">${fmt(m.inflow)}</td><td class="num">${fmt(m.outflow)}</td><td class="num">${fmt(m.net)}</td><td class="num">${pct(m.savingsRatePct)}</td></tr>`,
       )
       .join('')}</tbody></table>
     <p>Period totals — in ${money(cashflow.totals.inflow)}, out ${money(cashflow.totals.outflow)}, net ${money(cashflow.totals.net)}, avg savings ${pct(cashflow.totals.avgSavingsRatePct)}</p>
     ${
       cashflow.priorTotals
         ? `<p>Prior period — in ${money(cashflow.priorTotals.inflow)}, out ${money(cashflow.priorTotals.outflow)}, net ${money(cashflow.priorTotals.net)}</p>`
         : ''
     }
     <p>Salary → invest: ${pct(cashflow.salaryInvest.ratePct)} · attributed ${money(cashflow.salaryInvest.attributedSar)}</p>`,
  )}

  ${section(
    'report-budgets',
    '3. Budgets & spending',
    `<p class="muted">Analysis window preset used: ${esc(budgets.periodPresetUsed)}</p>
     ${budgetBars}
     <table><thead><tr><th>Category</th><th class="num">Spent</th><th class="num">Limit</th><th class="num">Util %</th><th>Status</th></tr></thead>
     <tbody>${budgets.categories
       .slice(0, 25)
       .map(
         (c) =>
           `<tr><td>${esc(c.category)}</td><td class="num">${fmt(c.spentSar)}</td><td class="num">${fmt(c.limitSar)}</td><td class="num">${pct(c.utilizationPct)}</td><td>${esc(c.status)}</td></tr>`,
       )
       .join('')}</tbody></table>`,
  )}

  ${section(
    'report-investments',
    '5. Investments',
    `<p>Exposure ${money(investments.totalExposureSar)} · ROI ${esc(investments.roiPctDisplay)} <span class="muted">(${esc(investments.roiAsOfLabel)})</span></p>
     <p>Net invested ${money(investments.netInvestedSar)} · Growth ${money(investments.growthSar)}</p>
     <p>Period portfolio P/L ${money(investments.periodPnLTotalSar)} (prior ${money(investments.priorPeriodPnLTotalSar)})</p>
     <p>Dividends ${money(investments.dividendsSar)} · Fees ${money(investments.feesSar)} · VAT ${money(investments.vatSar)}</p>
     <div class="grid2"><div><h3>Allocation</h3>${pie}</div><div><h3>Portfolio period P/L</h3>${portBars}</div></div>
     <table><thead><tr><th>Portfolio</th><th class="num">Value</th><th class="num">Total P/L</th><th class="num">Ledger</th><th class="num">Market</th></tr></thead>
     <tbody>${investments.portfolioPeriodPnL
       .map(
         (p) =>
           `<tr><td>${esc(p.portfolioName)}</td><td class="num">${fmt(p.valueSar)}</td><td class="num">${fmt(p.totalSar)}</td><td class="num">${fmt(p.ledgerSar)}</td><td class="num">${fmt(p.marketSar)}</td></tr>`,
       )
       .join('')}</tbody></table>`,
  )}

  ${section(
    'report-sukuk',
    '6. Sukuk & commodities',
    `<p>Direct Sukuk ${money(sukukCommodities.sukukExposureSar)} · Commodities ${money(sukukCommodities.commodityContributionSar)}</p>
     <table><thead><tr><th>Date</th><th>Name</th><th>Kind</th><th class="num">Amount</th></tr></thead>
     <tbody>${
       sukukCommodities.payoutEventsInPeriod.length
         ? sukukCommodities.payoutEventsInPeriod
             .map(
               (e) =>
                 `<tr><td>${esc(e.date)}</td><td>${esc(e.name)}</td><td>${esc(e.kind)}</td><td class="num">${fmt(e.amount, 2)} ${esc(e.currency)}</td></tr>`,
             )
             .join('')
         : '<tr><td colspan="4" class="muted">No Sukuk payouts in period.</td></tr>'
     }</tbody></table>`,
  )}

  ${section(
    'report-debt',
    '7. Debt & credit',
    `<p>Total liabilities ${money(debt.totalLiabilitiesSar)}${debt.stress ? ` · Stress ${esc(debt.stress.label)} (${fmt(debt.stress.score)})` : ''}</p>
     ${debtBars}`,
  )}

  ${section(
    'report-safety',
    '8. Safety, liquidity, risk',
    `<p>Emergency fund: ${fmt(safety.emergencyFund.monthsCovered, 1)} mo (${esc(safety.emergencyFund.status)}), shortfall ${money(safety.emergencyFund.shortfall)}</p>
     <p>Runway ${fmt(safety.runwayMonths, 1)} mo · Risk lane ${esc(safety.riskLane)} · Suggested ${esc(safety.suggestedProfile)}</p>
     <p>Discipline ${fmt(safety.disciplineScore)} · Household stress ${esc(safety.householdStress)}</p>
     <p>Deployable capital ${money(safety.capitalDeployableSar)}</p>
     <ul>${safety.shockDrills.map((s) => `<li>${esc(s.label)}: year-end Δ ${money(s.yearEndDelta)}</li>`).join('')}</ul>
     ${safety.lifestyleHits.length ? `<ul>${safety.lifestyleHits.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}`,
  )}

  ${section(
    'report-goals',
    '9. Goals, plan, forecast',
    `${goalBars}
     <table><thead><tr><th>Goal</th><th class="num">Progress</th><th class="num">Funded</th><th class="num">Target</th><th class="num">Gap</th><th>Timeline</th></tr></thead>
     <tbody>${goalsPlan.goals
       .map(
         (g) =>
           `<tr><td>${esc(g.name)}</td><td class="num">${pct(g.progressPct)}</td><td class="num">${fmt(g.fundedSar)}</td><td class="num">${fmt(g.targetSar)}</td><td class="num">${fmt(g.gapSar)}</td><td>${esc(g.timeline)}</td></tr>`,
       )
       .join('')}</tbody></table>
     <p>Plan rows: ${fmt(goalsPlan.planRowCount)} · Conflicts: ${goalsPlan.conflicts.length ? esc(goalsPlan.conflicts.join('; ')) : 'none'}</p>`,
  )}

  ${section(
    'report-zakat',
    '10. Zakat, insurance & rewards',
    `<p>Zakatable — cash ${money(zakatInsurance.zakatableCashSar)}, investments ${money(zakatInsurance.zakatableInvestmentsSar)}, Sukuk ${money(zakatInsurance.zakatableSukukSar)}, commodities ${money(zakatInsurance.zakatableCommoditiesSar)}</p>
     <p>Deductible liabilities ${money(zakatInsurance.deductibleLiabilitiesSar)} · Rewards memo ${money(zakatInsurance.rewardsSar)} (not cash)</p>
     <ul>${zakatInsurance.insuranceNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`,
  )}

  ${section(
    'report-quality',
    '11. Data quality',
    `${dataQuality.snapshotWarning ? `<p class="warn">${esc(dataQuality.snapshotWarning)}</p>` : ''}
     <p>Stale quotes: ${dataQuality.staleQuotes ? 'yes' : 'no'}</p>
     <ul>${dataQuality.integrityIssues.length ? dataQuality.integrityIssues.map((i) => `<li>${esc(i)}</li>`).join('') : '<li class="muted">No integrity issues reported.</li>'}</ul>`,
  )}

  ${section(
    'report-recommendations',
    '12. Recommendations',
    recommendations.length
      ? recommendations
          .map(
            (r) =>
              `<div class="rec ${esc(r.severity)}"><strong>${esc(r.title)}</strong><div class="muted">${esc(r.metricRef ?? '')}</div><div>${esc(r.detail)}</div></div>`,
          )
          .join('')
      : '<p class="muted">No recommendations for this period.</p>',
  )}

  ${section(
    'report-transactions',
    '4. Transactions',
    `<p>${fmt(transactions.count)} transactions · category summary below; full appendix follows.</p>
     <table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Count</th></tr></thead>
     <tbody>${transactions.byCategory
       .slice(0, 40)
       .map(
         (c) =>
           `<tr><td>${esc(c.category)}</td><td class="num">${fmt(c.amountSar)}</td><td class="num">${fmt(c.count)}</td></tr>`,
       )
       .join('')}</tbody></table>
     <h3>Transaction appendix</h3>
     <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead>
     <tbody>${txAppendix || '<tr><td colspan="5" class="muted">No transactions in period.</td></tr>'}</tbody></table>`,
  )}
</div>
</body>
</html>`;
}

/** Companion CSV for the same filtered transaction set as the report appendix. */
export function periodReportTransactionsCsv(model: PeriodFinancialReportModel): string {
  return exportCashTransactionsToCsv(model.transactions.rows);
}
