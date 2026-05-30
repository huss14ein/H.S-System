import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseMultiStockSymbols,
  formatMultiSymbolGroundingPromptBlock,
  buildMultiSymbolMarketGrounding,
  SAMPLE_MULTI_STOCK_SYMBOLS,
} from '../services/multiSymbolMarketGrounding';

vi.mock('../services/finnhubService', () => ({
  getQuoteWith52W: vi.fn(async (symbol: string) => ({
    c: 100,
    d: 1,
    dp: 1,
    h: 101,
    l: 99,
    o: 100,
    pc: 99,
    high52: 120,
    low52: 80,
    symbol,
  })),
  canonicalQuoteLookupKey: (s: string) => s.trim().toUpperCase(),
}));

describe('multiSymbolMarketGrounding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parseMultiStockSymbols dedupes and caps at 25', () => {
    const raw = 'nke, NKE, pltr\nuber  snap';
    expect(parseMultiStockSymbols(raw)).toEqual(['NKE', 'PLTR', 'UBER', 'SNAP']);
    const many = Array.from({ length: 30 }, (_, i) => `S${i}`).join(', ');
    expect(parseMultiStockSymbols(many)).toHaveLength(25);
  });

  it('sample list matches user request (19 tickers)', () => {
    expect(SAMPLE_MULTI_STOCK_SYMBOLS).toHaveLength(19);
    expect(SAMPLE_MULTI_STOCK_SYMBOLS).toContain('NKE');
    expect(SAMPLE_MULTI_STOCK_SYMBOLS).toContain('CELH');
  });

  it('formatMultiSymbolGroundingPromptBlock includes GROUND TRUTH header and rows', () => {
    const block = formatMultiSymbolGroundingPromptBlock({
      asOfIso: '2026-05-28T12:00:00.000Z',
      rows: [
        {
          symbol: 'NKE',
          price: 95.5,
          high52: 120,
          low52: 80,
          quoteSource: 'finova-live',
          rangePositionPct: 38.75,
        },
      ],
      promptBlock: '',
    });
    expect(block).toContain('MULTI-STOCK MARKET GROUND TRUTH');
    expect(block).toContain('NKE');
    expect(block).toContain('price=95.50');
    expect(block).toContain('52w=80.00–120.00');
  });

  it('buildMultiSymbolMarketGrounding merges live prices and watchlist fair value', async () => {
    const result = await buildMultiSymbolMarketGrounding({
      symbols: ['NKE'],
      simulatedPrices: { NKE: { price: 95.5, changePercent: 1.2 } },
      watchlistItems: [{ symbol: 'NKE', name: 'Nike', fairValue: 90 }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].price).toBe(95.5);
    expect(result.rows[0].fairValue).toBe(90);
    expect(result.rows[0].quoteSource).toBe('finova-live');
    expect(result.promptBlock).toContain('user-fair-value=90');
  });
});
