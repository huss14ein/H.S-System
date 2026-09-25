/**
 * Period Financial Report print HTML — browser Print / Save as PDF (no binary PDF lib).
 */
import type { PeriodFinancialReportModel, SoftSection } from './periodFinancialReportModel';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v.toLocaleString('en-SA', { maximumFractionDigits: 2 })} SAR`;
}

function pct(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${(v * (Math.abs(v) <= 2 ? 100 : 1)).toFixed(1)}%`;
}

function statusBadge(status: SoftSection<unknown>['status']): string {
  if (status === 'ok') return '<span class="badge ok">OK</span>';
  if (status === 'empty') return '<span class="badge empty">Empty</span>';
  return '<span class="badge err">Error</span>';
}

function svgBarChart(
  items: Array<{ label: string; value: number }>,
  opts?: { width?: number; height?: number },
): string {
  const width = opts?.width ?? 520;
  const height = opts?.height ?? 160;
  if (!items.length) return '<p class="muted">No chart data</p>';
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const barW = Math.max(8, Math.floor((width - 40) / items.length) - 6);
  const bars = items
    .map((it, idx) => {
      const h = Math.round((Math.abs(it.value) / max) * (height - 40));
      const x = 20 + idx * (barW + 6);
      const y = height - 20 - h;
      const fill = it.value >= 0 ? '#0f766e' : '#be123c';
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${fill}" rx="2"/>
        <text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="tick">${esc(it.label).slice(0, 8)}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img">${bars}</svg>`;
}

function svgSparkline(values: number[]): string {
  if (values.length < 2) return '';
  const w = 520;
  const h = 80;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-9);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 10) + 5;
      const y = h - 8 - ((v - min) / span) * (h - 16);
      return `${x},${y}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img"><polyline fill="none" stroke="#1d4ed8" stroke-width="2" points="${pts}"/></svg>`;
}

function renderSection(s: SoftSection<unknown>): string {
  const body =
    s.status === 'error'
      ? `<p class="err-msg">${esc(s.error)}</p>`
      : s.status === 'empty'
        ? `<p class="muted">No data for this section in the selected window.</p>`
        : renderSectionBody(s);
  return `<section id="${esc(s.id)}" class="sec">
    <h2>${esc(s.title)} ${statusBadge(s.status)}</h2>
    ${body}
  </section>`;
}

function renderSectionBody(s: SoftSection<unknown>): string {
  const d = s.data as Record<string, any>;
  switch (s.id) {
    case '1-executive': {
      const trend = (d.snapshotTrend as Array<{ at: string; netWorthSar: number }>) ?? [];
      return `<div class="grid">
        <div class="card"><div class="k">Net worth</div><div class="v">${money(d.netWorthSar)}</div></div>
        <div class="card"><div class="k">Liquid cash</div><div class="v">${money(d.liquidCashSar)}</div></div>
        <div class="card"><div class="k">Monthly P&amp;L</div><div class="v">${money(d.monthlyPnLSar)}</div></div>
        <div class="card"><div class="k">Investment ROI</div><div class="v">${pct(d.investmentRoi)}</div></div>
        <div class="card"><div class="k">EF months</div><div class="v">${esc(d.emergencyFundMonths ?? '—')}</div></div>
        <div class="card"><div class="k">Window</div><div class="v small">${esc(d.windowLabel)}</div></div>
        <div class="card"><div class="k">Snapshot Δ</div><div class="v">${money(d.snapshotDeltaSar)}</div></div>
      </div>
      <h3>Snapshot trend</h3>
      ${svgSparkline(trend.map((x) => Number(x.netWorthSar) || 0)) || '<p class="muted">No device snapshots in this window.</p>'}
      ${
        trend.length
          ? `<table><thead><tr><th>Date</th><th>Net worth</th></tr></thead><tbody>${trend
              .map((x) => `<tr><td>${esc(x.at)}</td><td class="num">${money(x.netWorthSar)}</td></tr>`)
              .join('')}</tbody></table>`
          : ''
      }`;
    }
    case '2-cashflow': {
      const cur = d.current ?? {};
      const wf = (d.waterfall as Array<{ label: string; sar: number }>) ?? [];
      return `<div class="grid">
        <div class="card"><div class="k">Income</div><div class="v">${money(cur.incomeSar)}</div></div>
        <div class="card"><div class="k">Expenses</div><div class="v">${money(cur.expensesSar)}</div></div>
        <div class="card"><div class="k">Net</div><div class="v">${money(cur.netSar)}</div></div>
        <div class="card"><div class="k">Δ vs prior</div><div class="v">${money(d.deltaNetSar)}</div></div>
      </div>
      <h3>Waterfall</h3>${svgBarChart(wf.map((x) => ({ label: x.label, value: x.sar })))}
      <p class="muted">Transfers out ${money(cur.transfersOutSar)} · in ${money(cur.transfersInSar)} · ${esc(cur.txCount)} txs</p>`;
    }
    case '3-budget': {
      const cats = (d.categories as Array<Record<string, unknown>>) ?? [];
      const rows = cats
        .slice(0, 15)
        .map(
          (c) =>
            `<tr><td>${esc(c.category)}</td><td class="num">${money(c.spentSar)}</td><td class="num">${money(c.limitSar)}</td><td class="num">${esc(c.utilizationPct ?? '')}%</td></tr>`,
        )
        .join('');
      const drift = (d.driftRows as Array<Record<string, unknown>>) ?? [];
      const driftRows = drift
        .slice(0, 10)
        .map(
          (r) =>
            `<tr><td>${esc(r.category)}</td><td class="num">${money(r.baselineSar)}</td><td class="num">${money(r.currentSar)}</td><td class="num">${esc(Number(r.driftPct).toFixed(0))}%</td></tr>`,
        )
        .join('');
      const insights = (d.insights as Array<{ title?: string; detail?: string }>) ?? [];
      const insightList = insights
        .slice(0, 8)
        .map((i) => `<li><strong>${esc(i.title)}</strong> — ${esc(i.detail)}</li>`)
        .join('');
      return `<table><thead><tr><th>Category</th><th>Spent</th><th>Limit</th><th>Util %</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No categories</td></tr>'}</tbody></table>
        <h3>Budget drift</h3>
        <table><thead><tr><th>Category</th><th>Baseline</th><th>Current</th><th>Drift</th></tr></thead><tbody>${driftRows || '<tr><td colspan="4">No drift rows</td></tr>'}</tbody></table>
        ${insightList ? `<h3>Insights</h3><ul>${insightList}</ul>` : ''}`;
    }
    case '4-portfolio-pnl': {
      const cur = d.current ?? {};
      const rows = ((cur.rows as Array<Record<string, any>>) ?? [])
        .map(
          (r) =>
            `<tr><td>${esc(r.portfolioName)}</td><td class="num">${money(r.window?.totalSar)}</td><td class="num">${money(r.window?.ledgerSar)}</td><td class="num">${money(r.window?.marketEstimateSar)}</td></tr>`,
        )
        .join('');
      return `<div class="grid">
        <div class="card"><div class="k">Total P/L</div><div class="v">${money(cur.totalSar)}</div></div>
        <div class="card"><div class="k">Ledger</div><div class="v">${money(cur.ledgerSar)}</div></div>
        <div class="card"><div class="k">Market est.</div><div class="v">${money(cur.marketEstimateSar)}</div></div>
        <div class="card"><div class="k">Prior total</div><div class="v">${money(d.prior?.totalSar)}</div></div>
      </div>
      <table><thead><tr><th>Portfolio</th><th>Total</th><th>Ledger</th><th>Market</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No portfolios</td></tr>'}</tbody></table>`;
    }
    case '5-holdings-gl': {
      const rows = ((d as unknown as Array<Record<string, unknown>>) ?? [])
        .map(
          (h) =>
            `<tr><td>${esc(h.name)}</td><td>${esc(h.symbol)}</td><td class="num">${money(h.valueSar)}</td><td class="num">${money(h.gainSar)}</td></tr>`,
        )
        .join('');
      return `<table><thead><tr><th>Holding</th><th>Symbol</th><th>Value</th><th>G/L</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No holdings</td></tr>'}</tbody></table>
      ${svgBarChart(((d as unknown as Array<{ name: string; gainSar: number }>) ?? []).slice(0, 8).map((h) => ({ label: String(h.name).slice(0, 8), value: Number(h.gainSar) || 0 })))}`;
    }
    case '6-subscriptions':
      return `<div class="grid">
        <div class="card"><div class="k">Est. monthly</div><div class="v">${money(d.estimatedMonthlySar)}</div></div>
        <div class="card"><div class="k">Est. window</div><div class="v">${money(d.estimatedWindowSar)}</div></div>
        <div class="card"><div class="k">Tagged txs</div><div class="v">${esc(d.subscriptionTxCount)}</div></div>
      </div>`;
    case '7-credit-cards': {
      const cards = (d as unknown as Array<Record<string, unknown>>) ?? [];
      const rows = cards
        .map(
          (c) =>
            `<tr><td>${esc(c.name)}</td><td class="num">${money(c.amountDue)}</td><td class="num">${money(c.purchaseFlow)}</td><td class="num">${money(c.payments)}</td><td class="num">${money(c.refundFlow)}</td></tr>`,
        )
        .join('');
      return `<table><thead><tr><th>Card</th><th>Due</th><th>Purchases</th><th>Payments</th><th>Refunds</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No credit cards</td></tr>'}</tbody></table>`;
    }
    case '8-installments': {
      const rows = ((d.rows as Array<Record<string, unknown>>) ?? [])
        .map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.note)}</td></tr>`)
        .join('');
      return `${d.note ? `<p class="muted">${esc(d.note)}</p>` : ''}
        <table><thead><tr><th>Name</th><th>Note</th></tr></thead><tbody>${rows || '<tr><td colspan="2">None</td></tr>'}</tbody></table>`;
    }
    case '9-household':
      return `<div class="grid">
        <div class="card"><div class="k">Planned net</div><div class="v">${money(d.plannedNetSar)}</div></div>
        <div class="card"><div class="k">Actual net</div><div class="v">${money(d.actualNetSar)}</div></div>
        <div class="card"><div class="k">Δ actual − planned</div><div class="v">${money(d.deltaSar)}</div></div>
      </div>
      <p>${esc(d.managedNote)}</p>
      <pre class="json">${esc(JSON.stringify({ householdStress: d.householdStress, discipline: d.discipline }, null, 2))}</pre>`;
    case '10-forecast': {
      const vals = ((d.rows as Array<Record<string, number>>) ?? []).map(
        (r) => Number(r['Net Worth'] ?? r.netWorth) || 0,
      );
      return `<div class="grid">
        <div class="card"><div class="k">Final NW (12M)</div><div class="v">${money(d.finalNetWorth)}</div></div>
        <div class="card"><div class="k">Final investments</div><div class="v">${money(d.finalInvestmentValue)}</div></div>
      </div>${svgSparkline(vals)}
      <table><thead><tr><th>Month</th><th>Net worth</th><th>Investments</th></tr></thead><tbody>${
        ((d.rows as Array<Record<string, unknown>>) ?? [])
          .slice(0, 12)
          .map(
            (r) =>
              `<tr><td>${esc(r.name)}</td><td class="num">${money(r['Net Worth'])}</td><td class="num">${money(r['Investment Value'])}</td></tr>`,
          )
          .join('') || '<tr><td colspan="3">No forecast rows</td></tr>'
      }</tbody></table>`;
    }
    case '11-transfers-recon':
      return `<div class="grid">
        <div class="card"><div class="k">Transfers out</div><div class="v">${money(d.transferOutSar)}</div></div>
        <div class="card"><div class="k">Transfers in</div><div class="v">${money(d.transferInSar)}</div></div>
        <div class="card"><div class="k">Dashboard monthly P&amp;L</div><div class="v">${money(d.dashboardMonthlyPnL)}</div></div>
        <div class="card"><div class="k">Summary monthly P&amp;L</div><div class="v">${money(d.summaryMonthlyPnL)}</div></div>
        <div class="card"><div class="k">Aligned</div><div class="v">${d.aligned ? 'Yes' : 'Check'}</div></div>
      </div>`;
    case '12-investment-roi':
      return `<div class="grid">
        <div class="card"><div class="k">ROI</div><div class="v">${pct(d.roi)}</div></div>
        <div class="card"><div class="k">Exposure</div><div class="v">${money(d.totalExposureSar)}</div></div>
        <div class="card"><div class="k">Net capital</div><div class="v">${money(d.netCapitalSar)}</div></div>
        <div class="card"><div class="k">Capital source</div><div class="v small">${esc(d.capitalSource)}</div></div>
      </div>`;
    case 'orphan-budget-insights': {
      const drift = (d.drift as Array<Record<string, unknown>>) ?? [];
      const insights = (d.insights as Array<{ title?: string; detail?: string }>) ?? [];
      return `<table><thead><tr><th>Category</th><th>Baseline</th><th>Current</th><th>Drift</th></tr></thead><tbody>${
        drift
          .map(
            (r) =>
              `<tr><td>${esc(r.category)}</td><td class="num">${money(r.baselineSar)}</td><td class="num">${money(r.currentSar)}</td><td class="num">${esc(Number(r.driftPct).toFixed(0))}%</td></tr>`,
          )
          .join('') || '<tr><td colspan="4">None</td></tr>'
      }</tbody></table>
        <ul>${insights.map((i) => `<li><strong>${esc(i.title)}</strong> — ${esc(i.detail)}</li>`).join('')}</ul>`;
    }
    case 'orphan-live-nw':
      return `<div class="grid">
        <div class="card"><div class="k">Live net worth</div><div class="v">${money(d.netWorth)}</div></div>
        <div class="card"><div class="k">Cash</div><div class="v">${money(d.buckets?.cash)}</div></div>
        <div class="card"><div class="k">Investments</div><div class="v">${money(d.buckets?.investments)}</div></div>
        <div class="card"><div class="k">Liabilities</div><div class="v">${money(d.buckets?.liabilities)}</div></div>
      </div>`;
    case 'orphan-ef':
      return `<div class="grid">
        <div class="card"><div class="k">Months covered</div><div class="v">${esc(d?.monthsCovered ?? '—')}</div></div>
        <div class="card"><div class="k">Target months</div><div class="v">${esc(d?.targetMonths ?? '—')}</div></div>
        <div class="card"><div class="k">Status</div><div class="v">${esc(d?.status ?? '—')}</div></div>
        <div class="card"><div class="k">Shortfall</div><div class="v">${money(d?.shortfall)}</div></div>
      </div>`;
    case 'orphan-pti-payoff': {
      const rows = ((d.payoffOrder as Array<Record<string, unknown>>) ?? [])
        .map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td class="num">${money(r.amount)}</td><td class="num">${esc(r.interestRate ?? '—')}</td></tr>`,
        )
        .join('');
      return `<div class="grid">
        <div class="card"><div class="k">PTI (est.)</div><div class="v">${d.ptiPct == null ? '—' : `${Number(d.ptiPct).toFixed(1)}%`}</div></div>
        <div class="card"><div class="k">Avg monthly income</div><div class="v">${money(d.avgMonthlyIncomeSar)}</div></div>
      </div>
      <p class="muted">${esc(d.note)}</p>
      <table><thead><tr><th>Liability</th><th>Type</th><th>Amount</th><th>Rate</th></tr></thead><tbody>${rows || '<tr><td colspan="4">None</td></tr>'}</tbody></table>`;
    }
    case 'orphan-salary':
      return `<div class="grid">
        <div class="card"><div class="k">Monthly income</div><div class="v">${money(d.monthlyIncome)}</div></div>
        <div class="card"><div class="k">Monthly P&amp;L</div><div class="v">${money(d.monthlyPnL)}</div></div>
        <div class="card"><div class="k">Savings rate</div><div class="v">${pct(d.savingsRate)}</div></div>
      </div>`;
    default:
      return `<pre class="json">${esc(JSON.stringify(d, null, 2).slice(0, 4000))}</pre>`;
  }
}

const PRINT_CSS = `
  :root { color-scheme: light; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 24px; line-height: 1.45; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.15rem; margin: 1.4rem 0 0.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
  h3 { font-size: 0.95rem; margin: 0.75rem 0 0.35rem; }
  .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 1rem; }
  .toc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 12px 0 20px; }
  .toc a { color: #1d4ed8; text-decoration: none; margin-right: 12px; display: inline-block; margin-bottom: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 8px 0 12px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #fff; }
  .k { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .v { font-size: 1.05rem; font-weight: 650; margin-top: 2px; }
  .v.small { font-size: 0.85rem; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 8px 0 12px; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
  th { font-size: 0.7rem; text-transform: uppercase; color: #64748b; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 999px; margin-left: 6px; }
  .badge.ok { background: #ccfbf1; color: #0f766e; }
  .badge.empty { background: #f1f5f9; color: #64748b; }
  .badge.err { background: #ffe4e6; color: #be123c; }
  .muted { color: #64748b; font-size: 0.85rem; }
  .err-msg { color: #be123c; }
  .json { background: #f8fafc; padding: 8px; overflow: auto; font-size: 0.75rem; max-height: 220px; }
  .tick { font-size: 9px; fill: #64748b; }
  .actions { margin-top: 1.5rem; font-size: 0.85rem; }
  @media print {
    body { margin: 12mm; }
    .toc a { color: inherit; }
    .sec { break-inside: avoid; }
  }
`;

export function generatePeriodFinancialReportHtml(model: PeriodFinancialReportModel): string {
  const toc = model.sections
    .map((s) => `<a href="#${esc(s.id)}">${esc(s.title.replace(/^\d+\.\s*/, ''))}</a>`)
    .join('');
  const body = model.sections.map(renderSection).join('\n');
  const actions = model.liveActions
    .map((a) => `<li>${esc(a.label)} → ${esc(a.page)}${a.action ? ` (${esc(a.action)})` : ''}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Period Financial Report — ${esc(model.twin.current.label)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <h1>Period Financial Report</h1>
  <p class="meta">
    ${esc(model.twin.current.label)} · Prior twin: ${esc(model.twin.prior.label)} · Generated ${esc(model.generatedAtIso)}
  </p>
  <nav class="toc" aria-label="Table of contents"><strong>Contents</strong><br/>${toc}</nav>
  ${body}
  <div class="actions">
    <h2>Live cross-engine actions</h2>
    <ul>${actions}</ul>
    <p class="muted">Use browser Print → Save as PDF. This report does not embed a binary PDF library.</p>
  </div>
</body>
</html>`;
}
