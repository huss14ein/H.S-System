import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('metric passport wiring', () => {
  it('MetricPassportProvider wraps authenticated shell', () => {
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('MetricPassportProvider');
  });

  it('MetricPassportDrawer and model exist', () => {
    expect(read('components/metrics/MetricPassportDrawer.tsx')).toContain('MetricPassportDrawer');
    expect(read('services/metricPassportModel.ts')).toContain('buildMetricPassportModel');
  });

  it('Wealth Analytics executive KPIs open passport', () => {
    expect(read('components/analytics/WealthAnalyticsDeferredSections.tsx')).toContain('useOpenMetricPassport');
  });

  it('Portfolio P/L breakdown drawer wired', () => {
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('PortfolioPeriodPnLBreakdownDrawer');
  });

  it('passport keys include weekly and portfolio period P/L', () => {
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain('weeklyPnL');
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain('portfolioPeriodPnL');
  });
});
