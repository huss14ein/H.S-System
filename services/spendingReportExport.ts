import type { ExpenseBudgetAnalysisModel } from './expenseBudgetAnalysisModel';

/** CSV export for Wealth & spending brief (SAR). */
export function buildSpendingBriefCsv(model: ExpenseBudgetAnalysisModel): string {
  const lines: string[] = [
    'Wealth & spending brief (SAR)',
    `Period,${model.periodLabel}`,
    `Scope,${model.scope}`,
    '',
    'Metric,Value (SAR)',
    `Spent MTD,${model.summary.expenseSar.toFixed(2)}`,
    `Budget envelope,${model.summary.budgetedSar.toFixed(2)}`,
    `Variance,${model.summary.budgetVarianceSar.toFixed(2)}`,
    `Savings rate %,${model.summary.savingsRatePct?.toFixed(1) ?? ''}`,
    `Categorized %,${model.summary.categorizedSharePct.toFixed(1)}`,
    '',
    'Category,Spent (SAR),Budget (SAR),Utilization %',
  ];
  for (const row of model.categories) {
    lines.push(
      `${csvEscape(row.category)},${row.spentSar.toFixed(2)},${row.limitSar.toFixed(2)},${row.utilizationPct.toFixed(1)}`,
    );
  }
  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadSpendingBriefCsv(model: ExpenseBudgetAnalysisModel, filename?: string): void {
  const csv = buildSpendingBriefCsv(model);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `finova-spending-brief-${model.periodLabel.replace(/\s+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Print-friendly HTML brief (browser Save as PDF). KSA scope — no tax appendix. */
export function buildSpendingBriefHtml(model: ExpenseBudgetAnalysisModel): string {
  const rows = model.categories
    .filter((c) => c.spentSar > 0 || c.limitSar > 0)
    .slice(0, 20)
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.category)}</td><td align="right">${c.spentSar.toFixed(0)}</td><td align="right">${c.limitSar.toFixed(0)}</td><td align="right">${c.utilizationPct.toFixed(0)}%</td></tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Wealth &amp; spending brief (SAR)</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #e2e8f0;padding:8px;font-size:13px}th{background:#f8fafc;text-align:left}</style>
</head><body>
<h1>Wealth &amp; spending brief (SAR)</h1>
<p><strong>Period:</strong> ${escapeHtml(model.periodLabel)} · <strong>Scope:</strong> ${escapeHtml(model.scope)}</p>
<ul>
<li>Spent: ${model.summary.expenseSar.toFixed(0)} SAR</li>
<li>Envelope: ${model.summary.budgetedSar.toFixed(0)} SAR</li>
<li>Variance: ${model.summary.budgetVarianceSar.toFixed(0)} SAR</li>
<li>Savings rate: ${model.summary.savingsRatePct?.toFixed(1) ?? '—'}%</li>
</ul>
<table><thead><tr><th>Category</th><th>Spent (SAR)</th><th>Budget (SAR)</th><th>Use %</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:24px;font-size:11px;color:#64748b">KSA household cashflow brief — SAR only, no tax appendix.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function downloadSpendingBriefPdf(model: ExpenseBudgetAnalysisModel): void {
  const html = buildSpendingBriefHtml(model);
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.setTimeout(() => w.print(), 300);
}
