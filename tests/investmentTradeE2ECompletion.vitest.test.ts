/**
 * Investment trade E2E completion — restore, CA orphans, migrations docs, all recordTrade entry points.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { investmentTransactionToRow } from '../services/investmentTransactionLedger';
import {
  portfolioHasBuyHistoryForSymbol,
  validateCorporateActionApplyPrerequisites,
} from '../services/corporateActionApply';
import { reconcileHoldingsWithCorporateActionsSync } from '../services/reconciliationEngine';
import { stampInvestmentTradeIdentity } from '../services/investmentTradeIdentity';
import { filterTransactionsForPortfolioReplay } from '../services/portfolioTransactionScope';
import type { CorporateActionEvent, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('investmentTradeE2ECompletion', () => {
  it('restoreFromBackup maps investment txs to snake_case (portfolio_id, account_id)', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('investmentTransactionToRow(');
    expect(ctx).toContain('includeId: true');
    expect(ctx).toContain('holdingToRow({');
    expect(ctx).toContain('investmentPortfolioToRow({');
    expect(ctx).not.toMatch(/investment_transactions'\)\.insert\(invTx\.map\(row\)\)/);

    const row = investmentTransactionToRow(
      {
        id: 'tx1',
        accountId: 'acc1',
        portfolioId: 'pf1',
        date: '2026-07-15',
        type: 'buy',
        symbol: 'AAPL',
        quantity: 2,
        price: 100,
        total: 200,
        currency: 'USD',
        linkedCashAccountId: 'cash1',
        idempotencyKey: 'idem-1',
      },
      null,
      { includeId: true },
    );
    expect(row).toMatchObject({
      id: 'tx1',
      account_id: 'acc1',
      portfolio_id: 'pf1',
      currency: 'USD',
      linked_cash_account_id: 'cash1',
      idempotency_key: 'idem-1',
    });
    expect(row).not.toHaveProperty('accountId');
    expect(row).not.toHaveProperty('portfolioId');
  });

  it('all recordTrade entry points pass portfolioId for buy/sell/dividend', () => {
    const investments = read('pages/Investments.tsx');
    expect(investments).toContain('portfolioId');
    expect(investments).toContain('recordTradeConfirmed');
    expect(investments).toContain('formatUnknownError');

    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('recordTrade');
    expect(stmt).toContain('portfolioId');

    const div = read('pages/DividendTrackerView.tsx');
    expect(div).toContain('recordTrade');
    expect(div).toContain('portfolioId');

    const sms = read('components/DividendSmsImportPanel.tsx');
    expect(sms).toContain('recordTrade');
    expect(read('services/dividendSmsParser.ts')).toContain('formatUnknownError');
    expect(read('services/dividendSmsParser.ts')).toContain('portfolioId: row.portfolioId');
  });

  it('ghost holdings lock: trade prep never sums; hydrate seal + unique migration', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).not.toContain('consolidateHoldingsBySymbol(symbolHoldingsForTrade)');
    expect(ctx).toContain('duplicateHoldingIdsForTrade');
    expect(ctx).toContain('resolveDuplicateHoldingsGroup');
    expect(ctx).toContain('sealHoldingsBookAfterTrade');
    expect(ctx).toContain('writeWorkspaceHydrateCache');
    expect(ctx).toContain('Skipping stale investments hydrate');
    expect(read('supabase/migrations/20260722120000_holdings_unique_per_portfolio_symbol.sql')).toContain(
      'holdings_user_portfolio_symbol_uidx',
    );
  });

  it('README documents portfolio_id and fee/vat migrations', () => {
    const readme = read('supabase/README_DB_MIGRATIONS.md');
    expect(readme).toContain('20260715120000_investment_transactions_portfolio_id.sql');
    expect(readme).toContain('20260715121000_investment_transactions_fee_vat_types.sql');
    expect(readme).toContain('20260715122000_backfill_investment_transactions_portfolio_id.sql');
    expect(readme).toContain('20260722120000_holdings_unique_per_portfolio_symbol.sql');
    const rebuild = read('supabase/rebuild_investments_tables_from_scratch.sql');
    expect(rebuild).toContain('DO NOT run on production');
    expect(rebuild).toContain('portfolio_id');
    expect(rebuild).toContain('idempotency_key');
    expect(rebuild).toContain('linked_cash_account_id');
    expect(rebuild).toContain("'fee'");
  });

  it('orphan buys count for CA prerequisites and reconciliation when held on same account', () => {
    const orphanBuy: InvestmentTransaction = {
      id: 'orphan-buy',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'INSP',
      quantity: 40,
      price: 50,
      total: 2000,
    };
    expect(
      portfolioHasBuyHistoryForSymbol({
        portfolioId: 'pf1',
        symbol: 'INSP',
        transactions: [orphanBuy],
        accountId: 'acc1',
        holdingSymbols: ['INSP'],
      }),
    ).toBe(true);

    const priorCa: CorporateActionEvent = {
      id: 'ca1',
      portfolioId: 'pf1',
      actionType: 'stock_split',
      symbol: 'INSP',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'ca-key',
      status: 'applied',
    };
    const allowed = validateCorporateActionApplyPrerequisites({
      portfolioId: 'pf1',
      symbol: 'INSP',
      transactions: [orphanBuy],
      corporateActionEvents: [priorCa],
      accountId: 'acc1',
      holdingSymbols: ['INSP'],
    });
    expect(allowed.valid).toBe(true);

    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'Test',
      accountId: 'acc1',
      holdings: [
        {
          id: 'h1',
          symbol: 'INSP',
          name: 'Insp',
          quantity: 40,
          avgCost: 50,
          currentValue: 2000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        },
      ],
    };
    const rec = reconcileHoldingsWithCorporateActionsSync({
      portfolio,
      symbol: 'INSP',
      transactions: [orphanBuy],
      corporateActionEvents: [],
    });
    expect(rec.ok).toBe(true);
    expect(rec.ledgerQuantity).toBe(40);
  });

  it('stamp + replay includes first buy of new symbol without inventing unrelated orphans', () => {
    const stamped = stampInvestmentTradeIdentity(
      {
        id: 'new-buy',
        accountId: 'acc1',
        date: '2026-07-15',
        type: 'buy',
        symbol: 'LCID',
        quantity: 10,
        price: 2,
        total: 20,
      },
      { portfolioId: 'pf1', currency: 'USD' },
    );
    const invent: InvestmentTransaction = {
      id: 'other-orphan',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'ZZZZ',
      quantity: 1,
      price: 1,
      total: 1,
    };
    const replayed = filterTransactionsForPortfolioReplay({
      portfolioId: 'pf1',
      transactions: [stamped, invent],
      holdingSymbols: [],
      accountId: 'acc1',
    });
    expect(replayed.map((t) => t.id)).toEqual(['new-buy']);
  });

  it('CA apply callers pass accountId into prerequisites', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('accountId: portfolio.accountId');
    expect(read('services/corporateActionWizardModel.ts')).toContain('accountId: portfolio.accountId');
    expect(read('components/investments/CorporateActionApplyPanel.tsx')).toContain(
      'accountId: portfolio.accountId',
    );
    expect(read('services/reconciliationEngine.ts')).toContain('filterTransactionsForPortfolioReplay');
  });
});
