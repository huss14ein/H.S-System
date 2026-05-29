import type { UiDir } from '../../context/LanguageContext';

/** Neutral range label (works in LTR and RTL). */
export function formatDashboardRangeLabel(from: string, to: string): string {
  return `${from} – ${to}`;
}

/** Symmetric Recharts margins; extra space on the Y-axis side in RTL. */
export function dashboardChartMargin(dir: UiDir): { top: number; right: number; left: number; bottom: number } {
  const yAxis = 12;
  return dir === 'rtl'
    ? { top: 10, right: 0, left: yAxis, bottom: 0 }
    : { top: 10, right: yAxis, left: 0, bottom: 0 };
}
