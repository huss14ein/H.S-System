/** Shared tone + accent colors for Wealth Analytics UI and print exports. */

export type WealthKpiTone = 'good' | 'warn' | 'bad' | 'neutral';

const KPI_ACCENT: Record<string, string> = {
  netWorth: '#6366f1',
  monthlyPnL: '#0ea5e9',
  emergencyFund: '#10b981',
  budgetVariance: '#f59e0b',
  investmentRoi: '#8b5cf6',
  weeklyPnL: '#06b6d4',
};

export function wealthKpiAccent(key: string): string {
  return KPI_ACCENT[key] ?? '#6366f1';
}

export function wealthKpiToneFromStatus(statusLabel: string): WealthKpiTone {
  const s = statusLabel.trim().toLowerCase();
  if (s === 'neutral') return 'neutral';
  if (/fund|on track|surplus|under budget|gain/.test(s)) return 'good';
  if (/watch|building/.test(s)) return 'warn';
  if (/deficit|gap|over budget|loss|rejected/.test(s)) return 'bad';
  return 'neutral';
}

export function signedValueTone(value: number, goodWhenPositive = true): WealthKpiTone {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) return 'neutral';
  if (goodWhenPositive) return value >= 0 ? 'good' : 'bad';
  return value <= 0 ? 'good' : 'bad';
}

export function disciplineTone(score: number): WealthKpiTone {
  if (score >= 75) return 'good';
  if (score >= 50) return 'warn';
  if (score > 0) return 'bad';
  return 'neutral';
}

export function runwayTone(months: number): WealthKpiTone {
  if (months >= 6) return 'good';
  if (months >= 3) return 'warn';
  if (months > 0) return 'bad';
  return 'neutral';
}

/** Human-readable indicator for UI badges and print. */
export function toneIndicatorLabel(tone: WealthKpiTone): string {
  if (tone === 'good') return 'On track';
  if (tone === 'warn') return 'Watch';
  if (tone === 'bad') return 'At risk';
  return 'Neutral';
}

export function tonePrintClass(tone: WealthKpiTone): string {
  return `tone-${tone}`;
}

export function badgePrintClass(tone: WealthKpiTone): string {
  return `badge badge-${tone}`;
}
