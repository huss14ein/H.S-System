/**
 * Record Trade + cash/tx path completion — wiring + behavior guards (phase E2E).
 * Trace: Investments modal → recordTrade → applyPositionDeltaForTrade → syncLotsAfterTrade.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatUnknownError } from '../utils/formatUnknownError';
import {
  filterTransactionsForPortfolio,
  filterTransactionsForPortfolioReplay,
  hasPositionAffectingTransactions,
} from '../services/portfolioTransactionScope';
import type { InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('recordTradeCompletion', () => {
  it('Investments Record Trade surfaces readable errors (not [object Object])', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('formatUnknownError');
    expect(page).toContain("formatUnknownError(error, 'Could not record trade.')");
    expect(page).toContain('recordTradeConfirmed');
    expect(page).toContain('confirmed: true');
    expect(page).not.toMatch(/setSubmitError\(error instanceof Error \? error\.message : String\(error\)\)/);
  });

  it('DataContext recordTrade throws Error(formatDbError) on insert failure', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('const recordTrade = async');
    expect(ctx).toContain('throw new Error(formatDbError(txError))');
    expect(ctx).toContain('throw new Error(formatDbError(invRpcErr))');
    expect(ctx).toContain('applyPositionDeltaForTrade');
    expect(ctx).toContain('syncLotsAfterTrade');
    expect(ctx).toContain('stampInvestmentTradeIdentity');
    expect(ctx).toContain('applyFinancialDataPatch');
    expect(ctx).toContain('formatUnknownError(error,');
    expect(ctx).toContain('resolveDuplicateHoldingsGroup');
    expect(ctx).toContain('sealHoldingsBookAfterTrade');
    expect(ctx).not.toContain('consolidateHoldingsBySymbol(symbolHoldingsForTrade)');
    expect(ctx).not.toMatch(/if \(txError\) \{[^}]*throw txError/);
    expect(ctx).not.toContain(
      'syncPortfolioAfterLedgerMutation(portfolio.id, { investmentTransactions: mergedTxs })',
    );
  });

  it('investment/ledger cash deltas read accounts from dataRef (eager patch), not stale data closure', () => {
    const ctx = read('context/DataContext.tsx');
    const invFn = ctx.slice(
      ctx.indexOf('const applyInvestmentAccountDeltaForTrade = async'),
      ctx.indexOf('const addTransaction = async'),
    );
    expect(invFn).toContain('const snap = dataRef.current ?? data');
    expect(invFn).toContain('resolveSarPerUsd(snap ?? null)');
    expect(invFn).not.toMatch(/const acc = \(data\?\.accounts/);
    const ledgerFn = ctx.slice(
      ctx.indexOf('const applyLedgerAccountDeltaForTransaction = async'),
      ctx.indexOf('const applyInvestmentAccountDeltaForTrade = async'),
    );
    expect(ledgerFn).toContain('const snap = dataRef.current ?? data');
  });

  it('post-sync buy patches name / assetClass / manual value / goal', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('goalId: tradeGoalId');
    expect(ctx).toContain('if (tradeData.type === \'buy\')');
    expect(ctx).toContain("const { data: holdingRow, error: holdingReadError } = await supabase");
    expect(ctx).toContain('needsPatch');
    expect(ctx).toContain('await updateHolding(patched)');
    expect(ctx).toContain('did not create an open holding');
  });

  it('holding validation failures throw and trade rollback restores the holding snapshot before refresh', () => {
    const ctx = read('context/DataContext.tsx');
    const addHolding = ctx.slice(ctx.indexOf('const addHolding = async'), ctx.indexOf('const updateHolding = async'));
    expect(addHolding).toContain('throw new Error(msg)');

    const rollback = ctx.slice(
      ctx.indexOf('Error updating holdings after trade:'),
      ctx.indexOf('// 4. If trade came from a plan'),
    );
    expect(rollback).toContain('restoreHoldingRowsAfterTradeRollback');
    expect(rollback).toContain('syncLotsAfterTrade');
    expect(rollback.indexOf('restoreHoldingRowsAfterTradeRollback')).toBeLessThan(rollback.indexOf('await fetchData()'));
  });

  it('CA apply/undo uses manual-only delta replay; traded books use full replay_derived', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('filterTransactionsForPortfolioReplay');
    expect(ctx).toContain('const manualOnly = !hasPositionAffectingTransactions(replayTxs)');
    expect(ctx).toContain("holdingsBaselineMode: manualOnly ? 'as_stored' : 'replay_derived'");
    expect(ctx).toContain('...(manualOnly ? { holdingsReplayEvents: [ev] } : {})');
    /**
     * Undo splits by book: a traded book marks the event reversed and rebuilds from the ledger
     * (`replay_derived`, no inverse row), while a manual book replays the inverse delta on stored holdings.
     */
    expect(ctx).toContain("holdingsBaselineMode: 'replay_derived'");
    expect(ctx).toContain('holdingsReplayEvents: [reversalEv]');
    expect(ctx).toContain('// Manual-only books: scoped inverse / delta replay remains valid.');
  });

  it('ledger sync scopes orphans by account + held/scoped symbols', () => {
    const scope = read('services/portfolioTransactionScope.ts');
    expect(scope).toContain('filterTransactionsForPortfolioReplay');
    expect(scope).toContain('scopedAccountId');
    expect(scope).toContain('allow.add(sym)');
    const apply = read('services/corporateActionApply.ts');
    expect(apply).toContain('filterTransactionsForPortfolioReplay({');
    expect(apply).toContain('accountId:');
    expect(apply).toContain('Hybrid baseline');
    const lots = read('services/portfolioLotReplayEngine.ts');
    expect(lots).toContain('holdingSymbols');
    expect(lots).toContain('accountId');
    const sync = read('services/portfolioLedgerSync.ts');
    expect(sync).toContain('formatUnknownError');
    expect(sync).toContain('Failed to save cost lots');
    expect(sync).toContain('const pos = replayed.get(upper)');
    expect(sync).not.toMatch(/await args\.updateHolding\(\{ \.\.\.h, realizedPnL: pnl \}\)/);
  });

  it('formatUnknownError never returns [object Object] for Supabase-shaped errors', () => {
    expect(
      formatUnknownError({
        message: 'violates foreign key constraint',
        code: '23503',
        details: 'Key (account_id) is not present',
      }),
    ).toMatch(/foreign key/i);
    expect(formatUnknownError({})).not.toBe('[object Object]');
  });

  it('orphan filter: same-account held symbol included; other-account excluded; unheld invent blocked', () => {
    const held: InvestmentTransaction = {
      id: 'orphan-insp',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'INSP',
      quantity: 40,
      price: 50,
      total: 2000,
    };
    const sell: InvestmentTransaction = {
      id: 'sell-insp',
      portfolioId: 'pf1',
      accountId: 'acc1',
      date: '2026-07-09',
      type: 'sell',
      symbol: 'INSP',
      quantity: 32,
      price: 49.5,
      total: 1584,
    };
    const otherAcc: InvestmentTransaction = {
      id: 'orphan-other',
      accountId: 'acc2',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'INSP',
      quantity: 999,
      price: 1,
      total: 999,
    };
    const invent: InvestmentTransaction = {
      id: 'orphan-lcid',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'LCID',
      quantity: 100,
      price: 1,
      total: 100,
    };
    const missingAccount = { ...held, id: 'orphan-missing-account', accountId: undefined as unknown as string };
    expect(filterTransactionsForPortfolio('pf1', [held, sell])).toHaveLength(1);
    const replayed = filterTransactionsForPortfolioReplay({
      portfolioId: 'pf1',
      transactions: [held, sell, otherAcc, invent, missingAccount],
      holdingSymbols: ['INSP'],
      accountId: 'acc1',
    });
    expect(replayed.map((t) => t.id).sort()).toEqual(['orphan-insp', 'sell-insp']);
  });

  it('only buy and sell rows make a portfolio replay-derived', () => {
    const nonPositionRows = [
      { type: 'dividend' },
      { type: 'deposit' },
      { type: 'withdrawal' },
      { type: 'fee' },
      { type: 'vat' },
    ] as unknown as InvestmentTransaction[];
    expect(hasPositionAffectingTransactions(nonPositionRows)).toBe(false);
    expect(hasPositionAffectingTransactions([{ ...nonPositionRows[0]!, type: 'buy' }])).toBe(true);
  });

  it('cash/dividend entry points use recordTrade with confirmed or system opts', () => {
    const sms = read('components/DividendSmsImportPanel.tsx');
    expect(sms).toContain('recordTrade');
    expect(sms).toContain('confirmed: true');
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('recordTrade');
    expect(stmt).toContain('system: true');
    const div = read('pages/DividendTrackerView.tsx');
    expect(div).toContain('recordTrade');
    expect(div).toContain('system: true');
  });
});
