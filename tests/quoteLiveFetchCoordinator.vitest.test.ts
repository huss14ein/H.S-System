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
});
