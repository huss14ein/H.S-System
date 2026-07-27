import { describe, expect, it } from 'vitest';
import { narrowLotReplayToTouchedSymbols } from '../services/portfolioLedgerSync';
import type { InvestmentTransaction } from '../types';
import type { CorporateActionReplayEvent } from '../services/portfolioReplayEngine';

describe('narrowLotReplayToTouchedSymbols', () => {
  const txs = [
    { id: '1', symbol: 'AAPL', type: 'buy', quantity: 10, date: '2026-01-01' },
    { id: '2', symbol: 'MSFT', type: 'buy', quantity: 5, date: '2026-01-02' },
    { id: '3', symbol: 'AAPL', type: 'sell', quantity: 2, date: '2026-02-01' },
  ] as InvestmentTransaction[];

  it('keeps only touched symbol ledger rows when no CAs', () => {
    const out = narrowLotReplayToTouchedSymbols({
      touched: new Set(['AAPL']),
      transactions: txs,
      corporateActions: [],
    });
    expect(out.transactions.map((t) => t.id)).toEqual(['1', '3']);
    expect(out.corporateActions).toEqual([]);
  });

  it('pulls linked CA symbols into the closure', () => {
    const cas: CorporateActionReplayEvent[] = [
      {
        id: 'ca1',
        executionDate: '2026-03-01',
        symbol: 'OLD',
        action: { type: 'merger', conversionRatio: 1, linkedSymbol: 'NEW' } as any,
      },
    ];
    const mergerTxs = [
      { id: 'o', symbol: 'OLD', type: 'buy', quantity: 10, date: '2026-01-01' },
      { id: 'n', symbol: 'NEW', type: 'buy', quantity: 1, date: '2026-04-01' },
      { id: 'x', symbol: 'OTHER', type: 'buy', quantity: 1, date: '2026-01-01' },
    ] as InvestmentTransaction[];
    const out = narrowLotReplayToTouchedSymbols({
      touched: new Set(['NEW']),
      transactions: mergerTxs,
      corporateActions: cas,
    });
    expect(out.transactions.map((t) => t.symbol).sort()).toEqual(['NEW', 'OLD']);
    expect(out.corporateActions).toHaveLength(1);
  });
});
