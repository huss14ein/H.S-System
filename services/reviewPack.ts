import type { FinancialData } from '../types';
import { computePersonalHeadlineNetWorthSar } from './personalNetWorth';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { computeHeadlinePersonalInvestmentRoiDecimal } from './investmentKpiCore';
import { presentHeadlineInvestmentGrowth } from './extendedMetricsPresentation';
import { detectBudgetDrift } from './budgetDrift';
import { detectGoalConflictsFromData } from './goalConflictDetection';
import { buildHoldingsDividendReconciliationReport } from './holdingsDividendReconciliation';
import { computeSalaryInvestmentKpis } from './salaryInvestmentKpis';

export type ReviewPackSection = { title: string; lines: string[] };

export function buildReviewPack(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: (id: string) => { SAR: number; USD: number },
  _monthlySurplusSar: number,
  simulatedPrices: SimulatedPriceMap = {},
): { title: string; generatedAt: string; sections: ReviewPackSection[]; markdown: string } {
  const nw = computePersonalHeadlineNetWorthSar(data, uiExchangeRate, {
    getAvailableCashForAccount,
    simulatedPrices,
  });
  const drift = detectBudgetDrift(data, uiExchangeRate);
  const goals = detectGoalConflictsFromData(data, uiExchangeRate);
  const recon = buildHoldingsDividendReconciliationReport(data);
  const salaryInvestment = computeSalaryInvestmentKpis(data, uiExchangeRate);
  const sections: ReviewPackSection[] = [
    {
      title: 'Net worth',
      lines: [`Headline NW: ${Math.round(nw.netWorth).toLocaleString()} SAR`, `FX: ${nw.sarPerUsd?.toFixed(2) ?? '—'} SAR/USD`],
    },
    {
      title: 'Investment growth',
      lines: (() => {
        const presented = presentHeadlineInvestmentGrowth(
          computeHeadlinePersonalInvestmentRoiDecimal(data, nw.sarPerUsd, getAvailableCashForAccount, simulatedPrices),
        );
        if (!presented) return ['No investment book yet.'];
        return [
          `Present value: ${Math.round(presented.presentValueSar).toLocaleString()} SAR`,
          `Net invested after withdrawals: ${Math.round(presented.netInvestedSar).toLocaleString()} SAR`,
          `Growth: ${Math.round(presented.growthSar).toLocaleString()} SAR`,
          `ROI: ${presented.valueDisplay}${presented.principalFullyRecovered ? ' (leftover value is profit)' : ''}`,
          presented.investmentAgeLabel ? `Time invested: ${presented.investmentAgeLabel}` : 'Time invested: add deposits to date this book',
        ];
      })(),
    },
    {
      title: 'Budget drift',
      lines: drift.slice(0, 5).map((d) => `${d.category}: ${d.driftPct.toFixed(0)}% vs 3-mo avg`),
    },
    {
      title: 'Goal conflicts',
      lines: goals.length ? goals.map((g) => g.message) : ['No goal funding conflicts detected.'],
    },
    {
      title: 'Salary to investment',
      lines: salaryInvestment?.hasSalarySignal
        ? [
            `Salary this month: ${Math.round(salaryInvestment.salaryIncomeSarMonth).toLocaleString()} SAR`,
            `Funded from salary: ${Math.round(salaryInvestment.investedFromSalarySarMonth).toLocaleString()} SAR (${salaryInvestment.salaryInvestRatePct.toFixed(1)}%)`,
            `Funded not deployed: ${Math.round(salaryInvestment.fundedNotDeployedSar).toLocaleString()} SAR`,
          ]
        : ['No salary signal detected this financial month.'],
    },
    {
      title: 'Data quality',
      lines: recon.isClean
        ? ['Holdings and dividend mirrors look consistent.']
        : recon.rows.slice(0, 5).map((r) => r.message),
    },
  ];
  const generatedAt = new Date().toISOString();
  const markdown = [
    `# Finova review pack`,
    `Generated: ${generatedAt}`,
    ...sections.flatMap((s) => [`## ${s.title}`, ...s.lines.map((l) => `- ${l}`)]),
  ].join('\n');
  return { title: 'Finova review pack', generatedAt, sections, markdown };
}

export function downloadReviewPackMarkdown(markdown: string, filename = 'finova-review-pack.md'): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
