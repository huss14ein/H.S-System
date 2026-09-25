/** Cross-shell signal to open Period Financial Report modal (hosted in Layout). */
export const PERIOD_FINANCIAL_REPORT_EVENT = 'finova:open-period-financial-report';

export function openPeriodFinancialReportModal(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PERIOD_FINANCIAL_REPORT_EVENT));
}
