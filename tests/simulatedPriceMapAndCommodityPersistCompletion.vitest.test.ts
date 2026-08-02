/**
 * Permanent guards for:
 * 1) SimulatedPrices ≡ SimulatedPriceMap (Netlify tsc / setter assignability)
 * 2) Commodity modal quote persist only after confirm + successful save
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dispatch, SetStateAction } from 'react';
import type { SimulatedPriceMap, SimulatedPriceRow } from '../services/investmentPlatformCardMetrics';
import type { SimulatedPrices } from '../context/MarketDataContext';
import type { SessionQuotePriceRow } from '../services/cachedQuoteRestore';
import type { QuotePriceRow } from '../services/corporateActionQuoteAdjust';
import { applyManualCommodityQuotes } from '../services/applyManualCommodityQuotes';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('simulatedPriceMapSotCompletion', () => {
  it('compile-time: session setter is assignable to applyManualCommodityQuotes', () => {
    // If SimulatedPrices drifts from SimulatedPriceMap again, this file fails tsc (and Netlify build).
    const setter: Dispatch<SetStateAction<SimulatedPrices>> = ((
      _v: SetStateAction<SimulatedPrices>,
    ) => undefined) as Dispatch<SetStateAction<SimulatedPrices>>;
    applyManualCommodityQuotes({
      prices: [{ symbol: 'XAU_GRAM_24K', price: 300 }],
      setSimulatedPrices: setter,
      db: null,
    });
  });

  it('compile-time: quote row aliases share SimulatedPriceRow', () => {
    const row: SimulatedPriceRow = { price: 1, change: 0, changePercent: 0 };
    const session: SessionQuotePriceRow = row;
    const corp: QuotePriceRow = row;
    const map: SimulatedPriceMap = { AAPL: session, MSFT: corp };
    expect(Object.keys(map)).toHaveLength(2);
  });

  it('wiring: MarketData + restore + split all alias SimulatedPriceMap/Row', () => {
    expect(read('context/MarketDataContext.tsx')).toContain('export type SimulatedPrices = SimulatedPriceMap');
    expect(read('services/cachedQuoteRestore.ts')).toContain('export type SessionQuotePriceRow = SimulatedPriceRow');
    expect(read('services/corporateActionQuoteAdjust.ts')).toContain('export type QuotePriceRow = SimulatedPriceRow');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('export type SimulatedPriceRow');
    expect(read('services/applyManualCommodityQuotes.ts')).toContain(
      'Dispatch<SetStateAction<SimulatedPriceMap>>',
    );
  });
});

describe('commodityQuotePersistAfterSaveCompletion', () => {
  it('modal submit: pending tick → confirm → onSave → applyManualCommodityQuotes', () => {
    for (const file of ['pages/Commodities.tsx', 'pages/Assets.tsx']) {
      const src = read(file);
      const confirmIdx = src.indexOf('const ok = await confirmAction(\n                summarizeCommodityForConfirm');
      expect(confirmIdx, `${file}: missing confirm`).toBeGreaterThan(-1);
      const submitStart = src.lastIndexOf('const handleSubmit', confirmIdx);
      expect(submitStart, `${file}: missing handleSubmit`).toBeGreaterThan(-1);
      const nextSubmit = src.indexOf('const handleSubmit', submitStart + 1);
      const block = src.slice(submitStart, nextSubmit === -1 ? undefined : nextSubmit);

      expect(block).toContain('pendingLiveQuote');
      expect(block).toContain('await confirmAction');
      expect(block).toMatch(/if \(!ok\) return;/);
      expect(block).toMatch(/await onSave[\s\S]*?applyManualCommodityQuotes/);
      // Must not persist quotes before save (decline or failed save must not drift KPIs).
      expect(block).not.toMatch(/applyManualCommodityQuotes[\s\S]{0,400}await onSave/);
      // Fetch only stages the pending tick.
      expect(block).toMatch(/pendingLiveQuote = \{ symbol: live\.symbol, price: live\.unitPrice \}/);
    }
  });

  it('Update Prices (explicit refresh) may persist immediately without holding save', () => {
    for (const file of ['pages/Commodities.tsx', 'pages/Assets.tsx']) {
      const src = read(file);
      const start = src.indexOf('const handleUpdatePrices');
      expect(start, `${file}: missing Update Prices`).toBeGreaterThan(-1);
      const block = src.slice(start, start + 2500);
      expect(block).toContain('batchUpdateCommodityHoldingValues');
      expect(block).toContain('applyManualCommodityQuotes');
    }
  });
});
