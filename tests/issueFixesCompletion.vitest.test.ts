/**
 * E2E completion: sell race, CA affected-only preview, reconcile exact amount,
 * reconcile≠withdrawal capital exclusion, and holdings integrity + qty reconcile.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isCapitalInvestmentDeposit,
  isCapitalInvestmentWithdrawal,
  isInvestmentReconciliationCashAdjustment,
  investmentLedgerTypeLabel,
} from '../services/reconciliation/cashDelta';
import { stampReconciliationNotesOntoInvestmentTransactions, mergePreserveInvestmentReconcileNotes } from '../services/investmentTradeIdentity';
import { resolveHoldingReconcileBook, parseReconcileActualBalanceInput } from '../services/reconciliation/preview';
import {
  buildHoldingsQtyDriftReport,
  buildHoldingsIntegrityFingerprint,
  classifyMissingLedgerHoldings,
  integrityLedgerQuantityForSymbol,
  listMissingLedgerHoldingsAcrossPortfolios,
} from '../services/holdingsIntegrityRepair';
import type { InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('tradeSellRaceCompletion', () => {
  it('every syncLotsAfterTrade site in DataContext passes patchHoldingRealizedPnL', () => {
    const ctx = read('context/DataContext.tsx');
    const marker = 'await syncLotsAfterTrade(';
    let from = 0;
    let count = 0;
    while (true) {
      const idx = ctx.indexOf(marker, from);
      if (idx < 0) break;
      count += 1;
      const chunk = ctx.slice(idx, idx + 1600);
      expect(chunk).toContain('patchHoldingRealizedPnL');
      from = idx + marker.length;
    }
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('sell post-check repairs local book from DB when qty lagged', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('did not update the holding quantity');
    expect(ctx).toContain('DB is correct but local book lagged');
    expect(ctx).toContain('normalizeHolding(holdingRow)');
  });

  it('stale hydrate protects investments + txs + lots together', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('dataRef.current?.investments ?? base.investments');
    expect(ctx).toContain('dataRef.current?.investmentTransactions');
    expect(ctx).toContain('dataRef.current?.investmentCostLots');
    expect(ctx).toContain('dataRef.current = next');
  });
});

describe('corporateActionAffectedPreviewCompletion', () => {
  it('preview filters to affected symbols and keeps qty-0 exits', () => {
    const model = read('services/corporateActionWizardModel.ts');
    expect(model).toContain('affectedSymbols');
    expect(model).toContain('affectedSymbols.has(r.symbol.toUpperCase())');
    expect(model).not.toMatch(/\.filter\(\(r\) => r\.quantity > 1e-9 && affectedSymbols/);
    const ui = read('components/investments/corporateActions/CorporateActionWizard.tsx');
    expect(ui).toContain('Affected positions after apply');
    expect(ui).not.toContain('Portfolio replay (after apply)');
  });
});

describe('reconcileExactAmountCompletion', () => {
  it('modal dirty flags + shared resolver keep qty-only WAC', () => {
    const modal = read('components/reconciliation/ReconcileQuantityModal.tsx');
    expect(modal).toContain('avgDirty');
    expect(modal).toContain('bookDirty');
    expect(modal).not.toContain('Math.abs(targetBookCost - beforeBook) > 0.004');
    const resolved = resolveHoldingReconcileBook({
      beforeQty: 150,
      actualQty: 50,
      beforeAvgCost: 10,
    });
    expect(resolved.mode).toBe('keep_wac');
    expect(resolved.avgCost).toBe(10);
    expect(resolved.bookCost).toBe(500);
  });

  it('Investments opens Reconcile quantity from live holding (not stale modal copy)', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('liveReconcileQtyHolding');
    expect(inv).toContain('ReconcileQuantityModal');
  });
});

describe('reconcileNotWithdrawalCompletion', () => {
  it('capital helpers exclude stamped reconcile rows', () => {
    const row: InvestmentTransaction = {
      id: 'r1',
      accountId: 'a1',
      date: '2026-08-08',
      type: 'withdrawal',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 500,
      note: 'reconciliation:reconcile_balance: Match statement',
    };
    expect(isInvestmentReconciliationCashAdjustment(row)).toBe(true);
    expect(isCapitalInvestmentWithdrawal(row)).toBe(false);
    expect(isCapitalInvestmentDeposit(row)).toBe(false);
    expect(investmentLedgerTypeLabel(row)).toBe('RECONCILE↓');
  });

  it('heuristic hydrate stamp is unambiguous 1:1 only (never mis-tags peer capital rows)', () => {
    const capital: InvestmentTransaction = {
      id: 'cap',
      accountId: 'acc-awaed',
      date: '2026-08-08',
      type: 'withdrawal',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 543.68,
    };
    const peer: InvestmentTransaction = {
      id: 'peer',
      accountId: 'acc-awaed',
      date: '2026-08-08',
      type: 'withdrawal',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 543.68,
    };
    const adj = {
      entityType: 'account' as const,
      accountId: 'acc-awaed',
      entityId: 'acc-awaed',
      effectiveDate: '2026-08-08',
      delta: -543.68,
      mechanism: 'reconcile_balance' as const,
      reason: 'System issue',
    };
    // Two same-day same-amount cash outs → refuse heuristic stamp.
    const ambiguous = stampReconciliationNotesOntoInvestmentTransactions([capital, peer], [adj]);
    expect(isCapitalInvestmentWithdrawal(ambiguous[0]!)).toBe(true);
    expect(isCapitalInvestmentWithdrawal(ambiguous[1]!)).toBe(true);

    // Unique orphan + unique adj → safe to stamp.
    const stamped = stampReconciliationNotesOntoInvestmentTransactions([capital], [adj]);
    expect(investmentLedgerTypeLabel(stamped[0]!)).toBe('RECONCILE↓');
    expect(isCapitalInvestmentWithdrawal(stamped[0]!)).toBe(false);
  });

  it('capital surfaces and persistence wire exclusion / note end-to-end', () => {
    const kpi = read('services/investmentKpiCore.ts');
    expect(kpi).toContain('isCapitalInvestmentDeposit');
    expect(kpi).toContain('isCapitalInvestmentWithdrawal');

    const cards = read('services/investmentPlatformCardMetrics.ts');
    expect(cards).toContain('isCapitalInvestmentDeposit');
    expect(cards).toContain('isCapitalInvestmentWithdrawal');

    const goals = read('services/goalProjectionFunding.ts');
    expect(goals).toContain('isCapitalInvestmentDeposit');

    const salary = read('services/salaryInvestmentKpis.ts');
    expect(salary).toContain('isInvestmentReconciliationCashAdjustment');

    const ledger = read('services/investmentTransactionLedger.ts');
    expect(ledger).toContain('row.note = note');

    const digest = read('services/digestFinancialData.ts');
    expect(digest).toContain('idempotencyKey');
    expect(digest).toContain('note:');

    const identity = read('services/investmentTradeIdentity.ts');
    expect(identity).toContain('unambiguous');
    expect(identity).toContain('generatedInvestmentTransactionId');
    expect(identity).toContain('mergePreserveInvestmentReconcileNotes');

    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('isInvestmentReconciliationCashAdjustment');
    expect(inv).toContain('Broker cash reconcile rows cannot be edited');
    expect(inv).toContain('investmentLedgerTypeLabel(editing)');

    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('isInvestmentReconciliationCashAdjustment(existing)');
    expect(ctx).toContain('Broker cash reconcile rows cannot be edited');
    expect(ctx).toContain('Broker cash reconcile rows cannot be deleted');
    expect(ctx).toContain('heavyInvStamped');
    expect(ctx).toContain('mergePreserveInvestmentReconcileNotes');
    expect(ctx).toContain('clearHoldingsIntegrityAckDurable');

    const payload = read('services/investmentTradeInsertPayload.ts');
    expect(payload).toContain('opts.note && note');

    const mig = read('supabase/migrations/20260808194430_investment_transactions_note.sql');
    expect(mig).toContain('add column if not exists note');
    expect(mig).toContain('reconciliation:reconcile_balance:');
  });
});

describe('holdingsIntegrityReconcileCompletion', () => {
  const portfolio: InvestmentPortfolio = {
    id: '4916db61-244e-446e-8cd7-a8f63db14362',
    name: "Hussein's Awaed",
    accountId: 'acc1',
    currency: 'USD',
    holdings: [
      {
        id: 'h-atyR',
        symbol: 'ATYR',
        quantity: 0,
        avgCost: 1,
        currentValue: 0,
        zakahClass: 'Zakatable',
      },
    ],
  };

  it('ATYR-style reconcile (−407) + closed book clears Critical missing', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: portfolio.id,
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
        portfolioId: portfolio.id,
        accountId: 'acc1',
        date: '2026-08-08',
        type: 'sell',
        symbol: 'ATYR',
        quantity: 593,
        price: 1,
        total: 593,
      },
    ];
    const adjustments = [
      {
        portfolioId: portfolio.id,
        symbol: 'ATYR',
        mechanism: 'reconcile_quantity' as const,
        status: 'applied' as const,
        delta: -407,
      },
    ];

    expect(classifyMissingLedgerHoldings({ portfolio, transactions: txs }).map((r) => r.symbol)).toContain(
      'ATYR',
    );
    expect(
      classifyMissingLedgerHoldings({ portfolio, transactions: txs, adjustments }).find(
        (r) => r.symbol === 'ATYR',
      ),
    ).toBeUndefined();

    const across = listMissingLedgerHoldingsAcrossPortfolios({
      investments: [portfolio],
      investmentTransactions: txs,
      reconciliationAdjustments: adjustments as any,
    });
    expect(across.find((r) => r.symbol === 'ATYR')).toBeUndefined();

    const drift = buildHoldingsQtyDriftReport({
      investments: [portfolio],
      investmentTransactions: txs,
      accounts: [],
      reconciliationAdjustments: adjustments as any,
    });
    const atyr = drift.find((r) => r.symbol === 'ATYR');
    expect(atyr?.ledgerQuantity).toBe(0);
    expect(atyr?.ok).toBe(true);
  });

  it('panel + notifications + hydrate + rebuild honor reconciliationAdjustments', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('reconciliationAdjustments: data.reconciliationAdjustments');
    expect(panel).toContain('corporateActionEvents: data.corporateActionEvents');
    expect(panel).toContain('buildHoldingsIntegrityFingerprint');
    expect(panel).toContain('buys − sells plus applied');

    const notif = read('context/NotificationsContext.tsx');
    expect(notif).toContain('holdingsIntegrityNotifications');
    expect(notif).toContain('buildHoldingsIntegrityFingerprint');
    expect(notif).not.toMatch(/coreNotifications[\s\S]{0,200}buildHoldingsQtyDriftReport/);

    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('integrityLedgerQuantityForSymbol');
    expect(ctx).toContain('ledgerForStamp');
    expect(ctx).toContain('sortByNewestFirst(normalizedInvestmentTransactions)');
    expect(ctx).toContain('dataRef.current = next');
    expect(ctx).toContain('Mirror applyFinancialDataPatch');

    const sync = read('services/portfolioLedgerSync.ts');
    expect(sync).toContain('reconciliationAdjustments?:');
    expect(sync).toContain('buildQtyReconcileDeltaIndex');
    expect(sync).toContain('if (hasCa) continue');

    const stamp = read('services/investmentTradeIdentity.ts');
    expect(stamp).toContain("=== 'reversed'");
    expect(stamp).toContain('unambiguousNoteByTxId');
    expect(stamp).toContain('txCandidatesByFingerprint');

    expect(read('pages/Investments.tsx')).toContain('HoldingsQtyIntegrityPanel');
    expect(read('pages/SystemHealth.tsx')).toContain('HoldingsQtyIntegrityPanel');
  });
});

describe('bugbotReviewChangesCompletion', () => {
  it('rejects garbage balance text that roundMoney would coerce to 0', () => {
    expect(parseReconcileActualBalanceInput('abc')).toBeNull();
    expect(parseReconcileActualBalanceInput('')).toBeNull();
    expect(parseReconcileActualBalanceInput('12.50')).toBe(12.5);
    expect(parseReconcileActualBalanceInput('1,234.56')).toBe(1234.56);
    const modal = read('components/reconciliation/ReconcileBalanceModal.tsx');
    expect(modal).toContain('parseReconcileActualBalanceInput');
    expect(modal).toContain('if (!preview)');
  });

  it('does not stack catch-up reconcile deltas onto CA-aware drift ledger', () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf-ca',
      name: 'CA',
      accountId: 'a1',
      currency: 'USD',
      holdings: [
        {
          id: 'h1',
          symbol: 'AAPL',
          quantity: 200,
          avgCost: 50,
          currentValue: 10000,
          zakahClass: 'Zakatable',
        },
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf-ca',
        accountId: 'a1',
        date: '2025-01-01',
        type: 'buy',
        symbol: 'AAPL',
        quantity: 100,
        price: 100,
        total: 10000,
      },
    ];
    const caEvents = [
      {
        id: 'ca1',
        portfolioId: 'pf-ca',
        actionType: 'stock_split' as const,
        symbol: 'AAPL',
        executionDate: '2025-06-01',
        ratioNumerator: 2,
        ratioDenominator: 1,
        idempotencyKey: 'k-ca',
        status: 'applied' as const,
      },
    ];
    const adjustments = [
      {
        portfolioId: 'pf-ca',
        symbol: 'AAPL',
        mechanism: 'reconcile_quantity' as const,
        status: 'applied' as const,
        delta: 100,
      },
    ];
    const driftQty = integrityLedgerQuantityForSymbol({
      portfolioId: 'pf-ca',
      symbol: 'AAPL',
      transactions: txs,
      adjustments,
      portfolio,
      corporateActionEvents: caEvents as any,
      mode: 'drift',
    });
    expect(driftQty).toBe(200);
    expect(driftQty).not.toBe(300);

    const missingClosed = integrityLedgerQuantityForSymbol({
      portfolioId: 'pf-ca',
      symbol: 'AAPL',
      transactions: txs,
      adjustments: [{ ...adjustments[0]!, delta: -200 }],
      portfolio,
      corporateActionEvents: caEvents as any,
      mode: 'missing',
    });
    expect(missingClosed).toBe(0);
  });

  it('integrity fingerprint includes CA identity (not count alone)', () => {
    const repair = read('services/holdingsIntegrityRepair.ts');
    expect(repair).toContain('caParts');
    expect(repair).toContain('actionType');
    expect(repair).toContain('ratioNumerator');
    expect(repair).toContain('tradeNetByKey');
    expect(repair).toContain('adjNetByKey');
  });

  it('integrity fingerprint changes when offsetting cross-symbol ledger edits', () => {
    const base = {
      investments: [
        {
          id: 'pf1',
          name: 'P',
          accountId: 'a1',
          currency: 'USD' as const,
          holdings: [
            { id: 'h1', symbol: 'AAA', quantity: 10, avgCost: 1, currentValue: 10, zakahClass: 'Zakatable' as const },
            { id: 'h2', symbol: 'BBB', quantity: 10, avgCost: 1, currentValue: 10, zakahClass: 'Zakatable' as const },
          ],
        },
      ],
      investmentTransactions: [
        {
          id: 'b1',
          portfolioId: 'pf1',
          accountId: 'a1',
          date: '2026-01-01',
          type: 'buy' as const,
          symbol: 'AAA',
          quantity: 10,
          price: 1,
          total: 10,
        },
        {
          id: 'b2',
          portfolioId: 'pf1',
          accountId: 'a1',
          date: '2026-01-01',
          type: 'buy' as const,
          symbol: 'BBB',
          quantity: 10,
          price: 1,
          total: 10,
        },
      ],
      reconciliationAdjustments: [],
      corporateActionEvents: [],
    };
    const fp1 = buildHoldingsIntegrityFingerprint(base);
    const offsetting = {
      ...base,
      investmentTransactions: [
        {
          ...base.investmentTransactions[0]!,
          quantity: 20, // +10 AAA
        },
        {
          ...base.investmentTransactions[1]!,
          quantity: 0, // −10 BBB (net workspace sum unchanged)
        },
      ],
    };
    // Global buySellMicro would stay flat; per-symbol keys must diverge.
    expect(buildHoldingsIntegrityFingerprint(offsetting)).not.toBe(fp1);
  });

  it('corrective migration enforces 1:1 heuristic note stamps', () => {
    const mig = read('supabase/migrations/20260808204500_fix_ambiguous_reconcile_note_heuristic.sql');
    expect(mig).toContain('adj_unique');
    expect(mig).toContain('tx_unique');
    expect(mig).toContain('generated_investment_transaction_id = it.id');
  });

  it('preserves reconcile notes across hydrate and clears keep_closed on qty reverse', () => {
    const prior: InvestmentTransaction = {
      id: 'tx1',
      accountId: 'a1',
      date: '2026-08-08',
      type: 'withdrawal',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 100,
      note: 'reconciliation:reconcile_balance: Match',
    };
    const incoming: InvestmentTransaction = {
      ...prior,
      note: undefined,
    };
    const merged = mergePreserveInvestmentReconcileNotes([incoming], [prior]);
    expect(merged[0]?.note).toContain('reconciliation:reconcile_balance:');

    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('heavyInvStamped');
    expect(ctx).toContain('clearHoldingsIntegrityAckDurable');
    expect(ctx).toContain("mechanism ?? '') === 'reconcile_quantity'");
  });
});
