/**
 * E2E wiring: Statement Upload SMS + categorize → import, and realized P/L system surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { categorizeImportedTransaction } from '../services/importTransactionCategorization';
import { planStatementImport, type StatementImportContext } from '../services/statementImportPrepare';
import { resolveDuplicateHoldingsGroup } from '../services/holdingsDedupe';
import type { Holding, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('statementUploadImportCompletion', () => {
  it('Statement Upload wires SMS parse → categorize → addTransaction category+budgetCategory', () => {
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('parseSMSTransactions');
    expect(stmt).toContain('enrichTransactionsWithBudgetMapping');
    expect(stmt).toContain('categorizeImportedTransaction');
    expect(stmt).toContain('budgetCategory: tx.budgetCategory');
    expect(stmt).toContain('category: tx.category');
    expect(stmt).toContain('focus-sms-tab');
    expect(stmt).toContain('pageAction');
  });

  it('SMS parser merchant-aware dedupe + amount-aware categories', () => {
    const parser = read('services/statementParser.ts');
    expect(parser).toContain('smsDedupeDescriptionKey');
    expect(parser).toContain('inferCategoryForSignedAmount');
    expect(parser).toContain('inferImportTransactionCategory');
    expect(parser).not.toMatch(/const key = `\$\{date\}\|\$\{mag\}`;/);
  });

  it('planStatementImport does not reject expenses missing budgetCategory', () => {
    const ctx: StatementImportContext = {
      accounts: [{ id: 'acc-1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' } as any],
      portfolios: [],
      existingBankTransactions: [],
      existingInvestmentTransactions: [],
      sarPerUsd: 3.75,
      preferredAccountId: 'acc-1',
    };
    const rows: Transaction[] = [
      {
        id: 't1',
        date: '2026-04-08',
        description: 'CAFE NERO',
        amount: -50,
        category: 'Food & Dining',
        accountId: 'acc-1',
        type: 'expense',
        status: 'Approved',
      },
      {
        id: 't2',
        date: '2026-04-08',
        description: 'JARIR BOOK',
        amount: -50,
        category: 'Shopping',
        accountId: 'acc-1',
        type: 'expense',
        status: 'Approved',
      },
    ];
    const plan = planStatementImport({
      bankTransactions: rows,
      investmentTransactions: [],
      selectedIndices: new Set([0, 1]),
      duplicateIndices: new Set(),
      ctx,
    });
    expect(plan.importableBankRows.length).toBe(2);
    expect(plan.skippedValidation).toBe(0);
  });

  it('categorizeImportedTransaction prefers history merchant budget', () => {
    const mapped = categorizeImportedTransaction(
      { type: 'expense', description: 'STARBUCKS RIYADH', amount: -22, category: 'Uncategorized' },
      {
        budgetCategoryNames: ['Food & Dining', 'Shopping'],
        userHistory: [
          {
            id: 'h',
            type: 'expense',
            description: 'STARBUCKS OLAYA',
            amount: -18,
            category: 'Food & Dining',
            budgetCategory: 'Food & Dining',
            accountId: 'a',
            date: '2026-01-01',
            status: 'Approved',
          },
        ],
      },
    );
    expect(mapped.budgetCategory).toBe('Food & Dining');
  });

  it('shell + palette + pageActions route SMS and realized P/L sync', () => {
    expect(read('utils/pageActions.ts')).toContain("page === 'Statement Upload'");
    expect(read('utils/pageActions.ts')).toContain('focus-sms-tab');
    expect(read('utils/pageActions.ts')).toContain('sync-realized-pnl');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain("case 'Statement Upload'");
    expect(read('components/CommandPalette.tsx')).toContain('Paste bank SMS transactions');
    expect(read('components/CommandPalette.tsx')).toContain('Sync realized P/L from ledger');
    expect(read('pages/Investments.tsx')).toContain("pageAction === 'sync-realized-pnl'");
    expect(read('context/DataContext.tsx')).toContain('backfillRealizedPnLForAllPortfolios');
  });

  it('duplicate holdings merge preserves realized PnL carrier', () => {
    const closed: Holding = {
      id: 'h-closed',
      symbol: 'AAPL',
      quantity: 0,
      avgCost: 0,
      currentValue: 0,
      realizedPnL: 250,
      zakahClass: 'Zakatable',
    };
    const ghost: Holding = {
      id: 'h-ghost',
      symbol: 'AAPL',
      quantity: 0,
      avgCost: 0,
      currentValue: 0,
      realizedPnL: 0,
      zakahClass: 'Zakatable',
    };
    const resolved = resolveDuplicateHoldingsGroup({
      holdings: [ghost, closed],
      portfolioId: 'pf1',
      symbol: 'AAPL',
      transactions: [],
    });
    expect(resolved.keep.realizedPnL).toBe(250);
    expect(resolved.deleteIds).toContain('h-ghost');
  });

  it('history reconcile requires description similarity (not date+amount alone)', () => {
    const src = read('context/StatementProcessingContext.tsx');
    expect(src).toContain('dateMatch && amountMatch && descSimilarity');
    expect(src).not.toContain('descSimilarity || amountMatch');
  });
});
