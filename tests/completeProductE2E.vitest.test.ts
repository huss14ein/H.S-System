import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildMetricPassportModel } from '../services/metricPassportModel';
import { buildFinancialDataForWeeklyDigest } from '../services/digestFinancialData';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const exists = (rel: string) => existsSync(join(process.cwd(), rel));

describe('complete product E2E wiring audit', () => {
  const checks: Array<[string, () => boolean]> = [
    ['metric passport on shell', () => read('components/AuthenticatedAppShell.tsx').includes('MetricPassportProvider')],
    ['FIFO path in period P/L', () => read('services/portfolioPeriodPnL.ts').includes('computePortfolioLedgerPnLSarInRangeWithFifo')],
    ['Dashboard operations cockpit', () => read('pages/Dashboard.tsx').includes('DashboardOperationsCockpitSection')],
    ['corporate action wizard', () => read('components/investments/corporateActions/CorporateActionWizard.tsx').includes('CorporateActionWizard')],
    ['corporate actions split E2E tests', () => exists('tests/corporateActionsSplitE2E.vitest.test.ts')],
    ['holdings dividend CA reconcile', () => read('services/holdingsDividendReconciliation.ts').includes('reconcileHoldingsWithCorporateActionsSync')],
    ['apply panel split prerequisites', () => read('components/investments/CorporateActionApplyPanel.tsx').includes('validateCorporateActionApplyPrerequisites')],
    ['quote cache scaled on split apply', () => read('context/MarketDataContext.tsx').includes('saveQuoteCacheRows')],
    ['ledger sync holdings baseline mode', () => read('services/portfolioLedgerSync.ts').includes('holdingsBaselineMode')],
    ['portfolio quote health chip', () => read('components/investments/PortfolioQuoteHealthChip.tsx').includes('PortfolioQuoteHealthChip')],
    ['zakat holding badge', () => read('services/zakatHoldingBadge.ts').includes('resolveZakatHoldingBadgeState')],
    ['digest portfolio P/L', () => read('services/portfolioPeriodPnLDigest.ts').includes('computeWeeklyDigestPortfolioPnLSar')],
    ['digest hydrates cost lots', () => read('services/digestFinancialData.ts').includes('investmentCostLotsRaw')],
    ['deprecated platform refresh', () => read('context/MarketDataContext.tsx').includes('@deprecated')],
    ['analytics workspace URL sync', () => read('context/AnalyticsWorkspaceContext.tsx').includes('parseAnalyticsWorkspaceFromSearch')],
    ['insight rail on WA overview', () => read('components/analytics/zones/OverviewZone.tsx').includes('AnalyticsInsightRail')],
    ['insight rail on Analysis command', () => read('pages/Analysis.tsx').includes('AnalyticsInsightRail')],
    ['Investments breakdown drawer', () => read('pages/Investments.tsx').includes('PortfolioPeriodPnLBreakdownDrawer')],
    ['analysis studio tabs', () => read('components/analysis/AnalysisStudioTabs.tsx').includes('AnalysisStudioTabs')],
    ['wealth analytics studio tests', () => exists('tests/wealthAnalyticsStudio.vitest.test.ts')],
    ['analysis studio tests', () => exists('tests/analysisStudio.vitest.test.ts')],
    ['sukuk diagnostic script', () => exists('scripts/diagnose-sukuk-positions.mjs')],
    ['period P/L breakdown drawer', () => read('components/investments/PortfolioPeriodPnLBreakdownDrawer.tsx').includes('PortfolioPeriodPnLBreakdownDrawer')],
  ];

  it.each(checks)('%s', (_label, pass) => {
    expect(pass()).toBe(true);
  });

  it('metric passport fallback returns full A/B/C sections', () => {
    const m = buildMetricPassportModel(null, 'weeklyPnL', {
      valueDisplay: 'SAR 1,000',
      statusLabel: 'Gain',
      sarPerUsd: 3.75,
    });
    expect(m?.sections).toHaveLength(3);
    expect(m?.sections.some((s) => s.id === 'C' && s.body.includes('FIFO'))).toBe(true);
  });

  it('digest builder maps investment cost lots', () => {
    const data = buildFinancialDataForWeeklyDigest({
      accountsRaw: [],
      assetsRaw: [],
      liabilitiesRaw: [],
      portfoliosRaw: [],
      commodityHoldingsRaw: [],
      investmentTransactionsRaw: [],
      investmentCostLotsRaw: [
        {
          id: 'lot-1',
          portfolio_id: 'p1',
          symbol: 'AAPL',
          quantity_remaining: 5,
          cost_per_share: 100,
          acquisition_date: '2026-01-01',
        },
      ],
      wealthUltraUserRow: null,
      wealthUltraGlobalRow: null,
    });
    expect(data.investmentCostLots?.length).toBe(1);
    expect(data.investmentCostLots?.[0]?.symbol).toBe('AAPL');
  });
});
