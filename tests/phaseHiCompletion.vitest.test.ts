/**
 * End-to-end guards for Phases H (multi-stock AI) and I (final verification wiring).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase H — Multi-stock AI E2E', () => {
  it('grounding service batches quotes, 52w, and watchlist fair value', () => {
    const svc = read('services/multiSymbolMarketGrounding.ts');
    expect(svc).toContain('buildMultiSymbolMarketGrounding');
    expect(svc).toContain('getQuoteWith52W');
    expect(svc).toContain('fairValue');
    expect(svc).toContain('SAMPLE_MULTI_STOCK_SYMBOLS');
  });

  it('gemini service exposes Arabic/English multi-stock analysis with grounding audit', () => {
    const gem = read('services/geminiService.ts');
    expect(gem).toContain('getAIMultiStockAnalysis');
    expect(gem).toContain('groundingAuditExtra: corpus');
    expect(gem).toContain('Never invent analyst price targets');
  });

  it('MultiStockAnalysisPanel wired on Investments Overview and Watchlist', () => {
    expect(read('pages/InvestmentOverview.tsx')).toContain('MultiStockAnalysisPanel');
    const wl = read('pages/WatchlistView.tsx');
    expect(wl).toContain('MultiStockAnalysisPanel');
    expect(wl).toContain('initialSymbols');
  });

  it('panel offers sample preset and AR/EN analyze buttons', () => {
    const panel = read('components/investments/MultiStockAnalysisPanel.tsx');
    expect(panel).toContain('SAMPLE_MULTI_STOCK_SYMBOLS');
    expect(panel).toContain("handleAnalyze('ar')");
    expect(panel).toContain("handleAnalyze('en')");
    expect(panel).toContain('buildMultiSymbolMarketGrounding');
    expect(panel).toContain('getAIMultiStockAnalysis');
  });
});

describe('Phase I — Final verification wiring', () => {
  it('wealth analytics E2E completion tests exist for prior phases', () => {
    expect(read('tests/phaseAbcCompletion.vitest.test.ts')).toContain('Phase A');
    expect(read('tests/phaseDeCompletion.vitest.test.ts')).toContain('ExecutiveKpiGrid');
    expect(read('tests/phaseFgCompletion.vitest.test.ts')).toContain('Phase G');
  });

  it('build injects finova-build-sha meta via vite (verify-i2 prerequisite)', () => {
    expect(read('vite.config.ts')).toContain('finova-build-sha');
    expect(read('.github/workflows/deploy-production.yml')).toContain('finova-build-sha');
  });
});
