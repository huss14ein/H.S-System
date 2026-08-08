/**
 * Missing holdings vs ledger classification + buy-path assert wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyMissingLedgerHoldings,
  ledgerNetAndLastLegForSymbol,
  listMissingLedgerHoldingsAcrossPortfolios,
} from '../services/holdingsIntegrityRepair';
import type { InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('missing holdings vs trade log', () => {
  const portfolio: InvestmentPortfolio = {
    id: 'pf1',
    name: 'Awaed',
    accountId: 'acc1',
    currency: 'USD',
    holdings: [
      {
        id: 'h-msft',
        symbol: 'MSFT',
        quantity: 5,
        avgCost: 100,
        currentValue: 500,
        zakahClass: 'Zakatable',
      },
    ],
  };

  it('classifies last-leg buy + net>0 as likelyOpen (critical gap)', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'ATYR',
        quantity: 1000,
        price: 1,
        total: 1000,
      },
    ];
    const rows = classifyMissingLedgerHoldings({ portfolio, transactions: txs });
    expect(rows).toEqual([
      expect.objectContaining({
        symbol: 'ATYR',
        ledgerNet: 1000,
        lastLeg: 'buy',
        likelyOpen: true,
      }),
    ]);
  });

  it('classifies last-leg sell as not likelyOpen (sold / incomplete)', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'AIIO',
        quantity: 100,
        price: 1,
        total: 100,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-06-01',
        type: 'sell',
        symbol: 'AIIO',
        quantity: 40,
        price: 2,
        total: 80,
      },
    ];
    // Net 60 but last leg sell → treat as sold/incomplete (do not auto-flag as must-restore)
    const { net, lastLeg } = ledgerNetAndLastLegForSymbol({
      portfolioId: 'pf1',
      symbol: 'AIIO',
      transactions: txs,
    });
    expect(net).toBe(60);
    expect(lastLeg).toBe('sell');
    const rows = classifyMissingLedgerHoldings({ portfolio, transactions: txs });
    expect(rows.find((r) => r.symbol === 'AIIO')?.likelyOpen).toBe(false);
  });

  it('ignores orphans without portfolio_id', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'orphan',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'GHOST',
        quantity: 50,
        price: 1,
        total: 50,
      },
    ];
    expect(classifyMissingLedgerHoldings({ portfolio, transactions: txs })).toEqual([]);
  });

  it('treats zero-quantity holding rows as missing (critical when last leg is buy)', () => {
    const portfolioWithZero: InvestmentPortfolio = {
      ...portfolio,
      holdings: [
        ...portfolio.holdings,
        {
          id: 'h-atyR-closed',
          symbol: 'ATYR',
          quantity: 0,
          avgCost: 1,
          currentValue: 0,
          zakahClass: 'Zakatable',
        },
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'ATYR',
        quantity: 1000,
        price: 1,
        total: 1000,
      },
    ];
    const rows = classifyMissingLedgerHoldings({ portfolio: portfolioWithZero, transactions: txs });
    expect(rows).toEqual([
      expect.objectContaining({
        symbol: 'ATYR',
        ledgerNet: 1000,
        lastLeg: 'buy',
        likelyOpen: true,
      }),
    ]);
  });

  it('applied reconcile_quantity clears missing holding even when buy−sell residual remains', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'ATYR',
        quantity: 1000,
        price: 1,
        total: 1000,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-06-01',
        type: 'sell',
        symbol: 'ATYR',
        quantity: 593,
        price: 1,
        total: 593,
      },
    ];
    const withoutAdj = classifyMissingLedgerHoldings({ portfolio, transactions: txs });
    expect(withoutAdj.find((r) => r.symbol === 'ATYR')?.ledgerNet).toBe(407);

    const adjustments = [
      {
        portfolioId: 'pf1',
        symbol: 'ATYR',
        mechanism: 'reconcile_quantity' as const,
        status: 'applied' as const,
        delta: -407,
      },
    ];
    const withAdj = classifyMissingLedgerHoldings({
      portfolio,
      transactions: txs,
      adjustments,
    });
    expect(withAdj.find((r) => r.symbol === 'ATYR')).toBeUndefined();

    const { net } = ledgerNetAndLastLegForSymbol({
      portfolioId: 'pf1',
      symbol: 'ATYR',
      transactions: txs,
      adjustments,
    });
    expect(net).toBe(0);
  });

  it('qty reconcile then sell (effective net 0) clears critical missing', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'ATYR',
        quantity: 407,
        price: 1,
        total: 407,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-08-08',
        type: 'sell',
        symbol: 'ATYR',
        quantity: 50,
        price: 1,
        total: 50,
      },
    ];
    const rows = classifyMissingLedgerHoldings({
      portfolio,
      transactions: txs,
      adjustments: [
        {
          portfolioId: 'pf1',
          symbol: 'ATYR',
          mechanism: 'reconcile_quantity',
          status: 'applied',
          delta: -357,
        },
      ],
    });
    expect(rows.find((r) => r.symbol === 'ATYR')).toBeUndefined();
  });

  it('listMissingLedgerHoldingsAcrossPortfolios sorts likelyOpen first', () => {
    const data = {
      investments: [portfolio],
      investmentTransactions: [
        {
          id: 'b-open',
          portfolioId: 'pf1',
          accountId: 'acc1',
          date: '2026-02-01',
          type: 'buy' as const,
          symbol: 'INSP',
          quantity: 10,
          price: 1,
          total: 10,
        },
        {
          id: 'b-old',
          portfolioId: 'pf1',
          accountId: 'acc1',
          date: '2026-01-01',
          type: 'buy' as const,
          symbol: 'AIIO',
          quantity: 5,
          price: 1,
          total: 5,
        },
        {
          id: 's-old',
          portfolioId: 'pf1',
          accountId: 'acc1',
          date: '2026-03-01',
          type: 'sell' as const,
          symbol: 'AIIO',
          quantity: 1,
          price: 1,
          total: 1,
        },
      ],
    };
    const rows = listMissingLedgerHoldingsAcrossPortfolios(data);
    expect(rows[0]?.symbol).toBe('INSP');
    expect(rows[0]?.likelyOpen).toBe(true);
  });

  it('buy path asserts open holding exists after trade', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('did not create an open holding');
    expect(ctx).toContain('Rolling back the trade so the ledger and positions stay aligned');
  });

  it('integrity panel passes reconciliationAdjustments into drift + missing builders', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('reconciliationAdjustments: data.reconciliationAdjustments');
    expect(panel).toContain('corporateActionEvents: data.corporateActionEvents');
    expect(panel).toContain('buildHoldingsIntegrityFingerprint');
    expect(panel).toContain('buys − sells plus applied');
  });

  it('integrity panel exposes Restore holding for likely-open gaps', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('Restore holding');
    expect(panel).toContain('Restore all missing holdings');
    expect(panel).toContain('listMissingLedgerHoldingsAcrossPortfolios');
    expect(panel).toContain('likelyOpen');
    expect(panel).toContain('Critical: trades on ledger, missing holding');
  });

  it('transaction log shows portfolio column for scope clarity', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('Portfolio');
    expect(page).toContain('Unassigned');
    expect(page).toContain('portfolios={portfolios}');
  });
});
