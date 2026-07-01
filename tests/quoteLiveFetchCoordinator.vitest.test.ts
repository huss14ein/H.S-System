import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/geminiService', () => ({
  getLivePrices: vi.fn(async (symbols: string[]) => {
    const out: Record<string, { price: number; change: number; changePercent: number }> = {};
    for (const s of symbols) out[s] = { price: 10, change: 0, changePercent: 0 };
    return out;
  }),
}));

import { getLivePrices } from '../services/geminiService';
import { getLivePricesDeduped, resetLivePriceFetchCoordinatorForTests } from '../services/quoteLiveFetchCoordinator';

describe('getLivePricesDeduped', () => {
  beforeEach(() => {
    resetLivePriceFetchCoordinatorForTests();
    vi.mocked(getLivePrices).mockClear();
  });

  it('shares one in-flight batch for identical symbol sets', async () => {
    const a = getLivePricesDeduped(['AAPL', 'MSFT']);
    const b = getLivePricesDeduped(['MSFT', 'AAPL']);
    await Promise.all([a, b]);
    expect(getLivePrices).toHaveBeenCalledTimes(1);
  });

  it('persists successful batches to quote cache', async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    } as Storage);

    await getLivePricesDeduped(['AAPL']);
    expect(store['finova-quote-cache-v1']).toBeTruthy();
    const parsed = JSON.parse(store['finova-quote-cache-v1']) as { rows: Record<string, { price: number }> };
    expect(parsed.rows.AAPL?.price).toBe(10);
  });

  it('forceFetch waits for network instead of timing out to cache', async () => {
    vi.mocked(getLivePrices).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ '2222.SR': { price: 32, change: 0, changePercent: 0 } }), 50);
        }),
    );
    const rows = await getLivePricesDeduped(['2222.SR'], { forceFetch: true });
    expect(rows['2222.SR']?.price).toBe(32);
  });
});
