/**
 * Adjustment & Reconciliation Engine — scenario matrix (§12) coverage.
 * Unit tests for protocols + wiring assertions for surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appCalendarTodayYmd,
  assertCanReverseAdjustment,
  assertTransferEditAllowed,
  buildCashReconcileLedgerTransaction,
  buildIdempotencyKey,
  collectMissingMarks,
  computeReconcileDelta,
  describeTransferDeleteCascade,
  isNoopDelta,
  isReconciliationLedgerCategory,
  isValidReason,
  latestRevisionPerDay,
  mechanismForEntity,
  normalizeNetWorthSnapshotRevisionRow,
  pendingApprovalsBlockAccount,
  previewCashAccountReconcile,
  previewHoldingQuantityReconcile,
  previewRevaluation,
  previewSukukPrincipalRestatement,
  reverseTargets,
  transferDeleteCascadeIds,
} from '../services/reconciliation';
import {
  countsAsExpenseForCashflowKpi,
  countsAsIncomeForCashflowKpi,
} from '../services/transactionFilters';
import { canPostTransactionToAccount } from '../services/dataQuality/accountPostingPolicy';
import type { Account, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('reconciliation cash protocols (§12 1–9)', () => {
  const checking: Account = {
    id: 'chk-1',
    name: 'Main',
    type: 'Checking',
    balance: 4800,
    currency: 'SAR',
  };

  it('1. Checking 4800 → 5000 computes +200 delta and income ledger row', () => {
    const preview = previewCashAccountReconcile({ account: checking, actualValue: 5000, reason: 'Bank statement' });
    expect(preview.delta).toBe(200);
    expect(preview.noop).toBe(false);
    const tx = buildCashReconcileLedgerTransaction({
      account: checking,
      delta: preview.delta,
      mechanism: 'reconcile_balance',
      reason: 'Bank statement',
    });
    expect(tx.amount).toBe(200);
    expect(tx.type).toBe('income');
    expect(tx.category).toBe('Reconciliation Adjustment');
    expect(countsAsIncomeForCashflowKpi(tx)).toBe(false);
  });

  it('2. Savings downward reconcile', () => {
    const savings: Account = { ...checking, id: 'sav', type: 'Savings', balance: 1000 };
    const preview = previewCashAccountReconcile({ account: savings, actualValue: 800, reason: 'Match bank' });
    expect(preview.delta).toBe(-200);
    const tx = buildCashReconcileLedgerTransaction({
      account: savings,
      delta: preview.delta,
      mechanism: 'reconcile_balance',
      reason: 'Match bank',
    });
    expect(tx.type).toBe('expense');
    expect(countsAsExpenseForCashflowKpi(tx)).toBe(false);
  });

  it('3. Credit reconcile preview mentions liability mirror', () => {
    const credit: Account = { ...checking, id: 'cc', type: 'Credit', balance: 1200 };
    const preview = previewCashAccountReconcile({ account: credit, actualValue: 1000, reason: 'Statement' });
    expect(preview.impacts.some((i) => /liability/i.test(i))).toBe(true);
  });

  it('5. USD account keeps USD currency on preview', () => {
    const usd: Account = { ...checking, currency: 'USD', balance: 100 };
    const preview = previewCashAccountReconcile({ account: usd, actualValue: 150, reason: 'USD stmt' });
    expect(preview.currency).toBe('USD');
    expect(preview.delta).toBe(50);
  });

  it('6. Zero delta no-op; idempotent key stable', () => {
    const preview = previewCashAccountReconcile({ account: checking, actualValue: 4800, reason: 'noop check' });
    expect(preview.noop).toBe(true);
    expect(isNoopDelta(0)).toBe(true);
    const k1 = buildIdempotencyKey({
      userId: 'u1',
      entityType: 'account',
      entityId: 'chk-1',
      effectiveDate: '2026-07-26',
      mechanism: 'reconcile_balance',
      delta: 0,
      reason: 'noop check',
    });
    const k2 = buildIdempotencyKey({
      userId: 'u1',
      entityType: 'account',
      entityId: 'chk-1',
      effectiveDate: '2026-07-26',
      mechanism: 'reconcile_balance',
      delta: 0,
      reason: 'noop check',
    });
    expect(k1).toBe(k2);
  });

  it('7. Opening balance only when ledger empty', () => {
    const emptyPreview = previewCashAccountReconcile({
      account: checking,
      actualValue: 100,
      reason: 'First open',
      mechanism: 'opening_balance',
      transactions: [],
    });
    expect(emptyPreview.mechanism).toBe('opening_balance');
    const withTx: Transaction[] = [
      {
        id: 't1',
        date: '2026-01-01',
        description: 'x',
        amount: 10,
        category: 'Food',
        accountId: checking.id,
        type: 'expense',
      },
    ];
    const later = previewCashAccountReconcile({
      account: checking,
      actualValue: 100,
      reason: 'Later',
      mechanism: 'opening_balance',
      transactions: withTx,
    });
    expect(later.mechanism).toBe('reconcile_balance');
  });

  it('7b. Broker platform with investment-ledger history cannot post an Opening Balance', () => {
    const platform: Account = { ...checking, id: 'plat-1', type: 'Investment', balance: 9000 };
    const fresh = previewCashAccountReconcile({
      account: platform,
      actualValue: 9500,
      reason: 'First funding',
      mechanism: 'opening_balance',
      transactions: [],
      investmentTransactions: [],
    });
    expect(fresh.mechanism).toBe('opening_balance');
    // Broker deposits/trades live in the investment ledger, never in cash `transactions`.
    const active = previewCashAccountReconcile({
      account: platform,
      actualValue: 9500,
      reason: 'Statement drift',
      mechanism: 'opening_balance',
      transactions: [],
      investmentTransactions: [{ accountId: 'plat-1' }],
    });
    expect(active.mechanism).toBe('reconcile_balance');
    // Legacy rows stamped only with portfolio_id still count as activity.
    const viaPortfolio = previewCashAccountReconcile({
      account: platform,
      actualValue: 9500,
      reason: 'Statement drift',
      mechanism: 'opening_balance',
      transactions: [],
      investmentTransactions: [{ portfolioId: 'pf-1' }],
      portfolioIds: ['pf-1'],
    });
    expect(viaPortfolio.mechanism).toBe('reconcile_balance');
  });

  it('7c. Reconcile surfaces feed broker ledger activity into the modal', () => {
    const modal = read('components/reconciliation/ReconcileBalanceModal.tsx');
    expect(modal).toContain('investmentTransactions');
    for (const page of ['pages/Accounts.tsx', 'pages/Investments.tsx']) {
      const src = read(page);
      expect(src).toContain('investmentTransactions={data?.investmentTransactions}');
      expect(src).toContain('portfolioIdsForAccount');
    }
    // Server-side apply resolves the mechanism from the same sources.
    expect(read('services/reconciliation/preview.ts')).toContain(
      'portfolioIds: portfolioIdsForAccount(data, account.id)',
    );
  });

  it('9. Reverse targets invert delta; double-reverse blocked', () => {
    const adj = {
      id: 'a1',
      mechanism: 'reconcile_balance' as const,
      entityType: 'account' as const,
      entityId: 'chk-1',
      effectiveDate: '2026-07-26',
      currency: 'SAR' as const,
      beforeValue: 4800,
      actualValue: 5000,
      delta: 200,
      reason: 'fix',
      idempotencyKey: 'k',
      status: 'applied' as const,
    };
    expect(reverseTargets(adj).delta).toBe(-200);
    expect(assertCanReverseAdjustment(adj)).toBeNull();
    expect(assertCanReverseAdjustment({ ...adj, status: 'reversed' })).toMatch(/already reversed/i);
  });

  it('31. Pending approvals block account', () => {
    const txs: Transaction[] = [
      {
        id: 'p1',
        date: '2026-07-01',
        description: 'pending',
        amount: -10,
        category: 'Food',
        accountId: 'chk-1',
        type: 'expense',
        status: 'Pending',
      },
    ];
    expect(pendingApprovalsBlockAccount('chk-1', txs)).toBe(true);
  });

  it('33. Reason min length + app calendar today', () => {
    expect(isValidReason('ab')).toBe(false);
    expect(isValidReason('abc')).toBe(true);
    expect(appCalendarTodayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('reconciliation investment / revaluation protocols', () => {
  it('12. Positive qty without cost basis rejected', () => {
    const p = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 10,
      actualQty: 12,
      reason: 'Broker stmt',
    });
    expect(p.blockedReason).toMatch(/cost basis/i);
  });

  it('11. Quantity decrease allowed without cost', () => {
    const p = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 10,
      actualQty: 8,
      reason: 'Broker stmt',
    });
    expect(p.blockedReason).toBeUndefined();
    expect(p.delta).toBe(-2);
  });

  it('22–23. Asset revaluation has no cash implication in copy', () => {
    const up = previewRevaluation({
      entityType: 'asset',
      entityId: 'a1',
      beforeValue: 100000,
      actualValue: 110000,
      reason: 'Appraisal',
    });
    expect(up.delta).toBe(10000);
    expect(up.impacts.some((i) => /no cash/i.test(i))).toBe(true);
    const down = previewRevaluation({
      entityType: 'asset',
      entityId: 'a1',
      beforeValue: 100000,
      actualValue: 90000,
      reason: 'Depreciation',
    });
    expect(down.delta).toBe(-10000);
  });

  it('38. Missing historical marks block replay', () => {
    const missing = collectMissingMarks({
      symbols: ['AAPL'],
      effectiveFrom: '2026-01-01',
      throughDate: '2026-07-01',
      marks: {},
    });
    expect(missing).toContain('AAPL');
  });
});

describe('posting policy + category filters', () => {
  it('allows reconciliation onto zero balance checking', () => {
    const out = canPostTransactionToAccount(
      { id: 'c1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Reconciliation Adjustment' },
    );
    expect(out.allowed).toBe(true);
  });

  it('excludes reconciliation categories from cashflow KPIs', () => {
    expect(isReconciliationLedgerCategory('Opening Balance')).toBe(true);
    expect(
      countsAsIncomeForCashflowKpi({ type: 'income', category: 'Opening Balance' }),
    ).toBe(false);
  });
});

describe('reconciliation wiring + live-data migration', () => {
  it('migration is additive and defines preview/apply/reverse RPCs', () => {
    const sql = read('supabase/migrations/20260726120000_reconciliation_adjustment_engine.sql');
    expect(sql).toContain('reconciliation_adjustments');
    expect(sql).toContain('reconciliation_runs');
    expect(sql).toContain('reconciliation_audit_events');
    expect(sql).toContain('net_worth_snapshot_revisions');
    expect(sql).toContain('preview_reconciliation_adjustment');
    expect(sql).toContain('apply_reconciliation_adjustment');
    expect(sql).toContain('reverse_reconciliation_adjustment');
    expect(sql.toLowerCase()).not.toMatch(/drop\s+table/);
    expect(sql.toLowerCase()).not.toMatch(/truncate/);
    expect(sql).not.toContain('rebuild_investments_tables_from_scratch');
  });

  it('DataContext exposes preview/apply/reverse and wipes reconciliation tables on reset', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('applyReconciliationAdjustment');
    expect(ctx).toContain('reverseReconciliationAdjustment');
    expect(ctx).toContain('previewReconciliationAdjustment');
    expect(ctx).toContain('reconciliation_adjustments');
    expect(ctx).toContain('reconciliation_audit_events');
    // Ledger-backed CA undo excludes inverse insert path
    expect(ctx).toContain("holdingsBaselineMode: 'replay_derived'");
    expect(ctx).toContain('manualOnly');
  });

  it('Accounts uses Reconcile Balance; strips absolute overwrite on edit', () => {
    const page = read('pages/Accounts.tsx');
    expect(page).toContain('ReconcileBalanceModal');
    expect(page).toContain('onReconcileBalance');
    expect(page).toContain('never overwrite balance');
  });

  it('System Health hosts authoritative audit panel', () => {
    const page = read('pages/SystemHealth.tsx');
    expect(page).toContain('ReconciliationAuditPanel');
    expect(page).toContain('reconciliation-audit-log');
  });

  it('Transactions labels book-adjust rows and blocks casual edit', () => {
    const page = read('pages/Transactions.tsx');
    expect(page).toContain('isReconciliationLedgerCategory');
    expect(page).toContain('Book adjust');
    expect(page).toContain('reconciliation-audit-log');
  });

  it('exception repair copy recommends Reconcile Balance', () => {
    const src = read('services/exceptionHandlingEngine.ts');
    expect(src).toContain('Reconcile Balance');
    expect(src).not.toContain('Set or correct opening balance for account to match transaction ledger');
  });

  it('computeReconcileDelta is actual − before', () => {
    expect(computeReconcileDelta(4800, 5000)).toBe(200);
  });
});

describe('Sukuk principal restatement protocol', () => {
  it('restates outstanding principal without a cash transaction and preserves posted payouts', () => {
    const p = previewSukukPrincipalRestatement({
      positionId: 'sk-1',
      beforeValue: 100000,
      actualValue: 90000,
      faceValue: 100000,
      currency: 'SAR',
      reason: 'Issuer amortization notice',
    });
    expect(p.mechanism).toBe('sukuk_face_yield');
    expect(p.entityType).toBe('sukuk_position');
    expect(p.delta).toBe(-10000);
    expect(p.blockedReason).toBeUndefined();
    expect(p.impacts.some((i) => /no cash transaction/i.test(i))).toBe(true);
    expect(p.impacts.some((i) => /posted coupon\/principal payouts are preserved/i.test(i))).toBe(true);
  });

  it('blocks principal above face value and negative principal', () => {
    expect(
      previewSukukPrincipalRestatement({
        positionId: 'sk-1',
        beforeValue: 100000,
        actualValue: 120000,
        faceValue: 100000,
        reason: 'typo',
      }).blockedReason,
    ).toMatch(/face value/i);
    expect(
      previewSukukPrincipalRestatement({
        positionId: 'sk-1',
        beforeValue: 100000,
        actualValue: -5,
        reason: 'typo',
      }).blockedReason,
    ).toMatch(/non-negative/i);
  });

  it('mechanismForEntity maps every reconcilable entity to one mechanism', () => {
    expect(mechanismForEntity('sukuk_position')).toBe('sukuk_face_yield');
    expect(mechanismForEntity('asset')).toBe('asset_revaluation');
    expect(mechanismForEntity('commodity')).toBe('commodity_revaluation');
    expect(mechanismForEntity('liability')).toBe('liability_restatement');
    expect(mechanismForEntity('holding')).toBe('reconcile_quantity');
    expect(mechanismForEntity('account', 'opening_balance')).toBe('opening_balance');
  });

  it('orchestrator restates the position, regenerates only future events, and audits', () => {
    const src = read('services/reconciliation/orchestrator.ts');
    expect(src).toContain('applySukukPrincipal');
    expect(src).toContain('regenerateSukukFutureSchedule');
    expect(src).toContain("mechanism: 'sukuk_face_yield'");
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('regenerateSukukFutureSchedule');
    expect(ctx).toContain('saveSukukPayoutSchedule');
  });

  it('Sukuk UI restates through the engine instead of overwriting principal', () => {
    const src = read('components/investments/SukukInvestmentsSection.tsx');
    expect(src).toContain('Restate principal');
    expect(src).toContain('applyReconciliationAdjustment');
    expect(src).toContain("entityType=\"sukuk_position\"");
  });
});

describe('transfer-safe corrections', () => {
  const legs: Transaction[] = [
    {
      id: 'out',
      date: '2026-07-01',
      description: 'Transfer to savings',
      amount: -500,
      category: 'Transfer',
      accountId: 'chk',
      type: 'expense',
      transferGroupId: 'grp-1',
      transferRole: 'principal_out',
    } as Transaction,
    {
      id: 'in',
      date: '2026-07-01',
      description: 'Transfer from checking',
      amount: 500,
      category: 'Transfer',
      accountId: 'sav',
      type: 'income',
      transferGroupId: 'grp-1',
      transferRole: 'principal_in',
    } as Transaction,
    {
      id: 'solo',
      date: '2026-07-02',
      description: 'Groceries',
      amount: -80,
      category: 'Food',
      accountId: 'chk',
      type: 'expense',
    } as Transaction,
  ];

  it('deleting one leg cascades to the whole transfer group', () => {
    expect(transferDeleteCascadeIds(legs, 'out').sort()).toEqual(['in', 'out']);
    expect(describeTransferDeleteCascade(2)).toMatch(/orphaned/i);
  });

  it('non-transfer rows delete alone', () => {
    expect(transferDeleteCascadeIds(legs, 'solo')).toEqual(['solo']);
    expect(describeTransferDeleteCascade(1)).toBeNull();
  });

  it('blocks money-field edits on a single leg but allows description edits', () => {
    const leg = legs[0];
    expect(assertTransferEditAllowed(leg, { ...leg, amount: -600 })).toMatch(/other leg/i);
    expect(assertTransferEditAllowed(leg, { ...leg, accountId: 'other' })).toMatch(/other leg/i);
    expect(assertTransferEditAllowed(leg, { ...leg, date: '2026-07-05' })).toMatch(/other leg/i);
    expect(assertTransferEditAllowed(leg, { ...leg, description: 'Renamed transfer' })).toBeNull();
    expect(assertTransferEditAllowed(legs[2], { ...legs[2], amount: -90 })).toBeNull();
  });

  it('DataContext enforces the guard and cascade', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('assertTransferEditAllowed');
    expect(ctx).toContain('transferDeleteCascadeIds');
    expect(ctx).toContain('describeTransferDeleteCascade');
  });
});

describe('recurring rules never mint reconciliation rows', () => {
  it('DataContext blocks the categories on create, update, and monthly apply', () => {
    const ctx = read('context/DataContext.tsx');
    const guardCount = ctx.split('isReconciliationLedgerCategory(').length - 1;
    expect(guardCount).toBeGreaterThanOrEqual(3);
    expect(ctx).toContain('RECURRING_RECONCILE_CATEGORY_ERROR');
  });
});

describe('broker cash reconcile does not require a linked cash account', () => {
  it('DataContext inserts the investment ledger row directly instead of recordTrade transfer path', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('recordBrokerCashReconcileRow');
    expect(ctx).toContain('recordBrokerCashAdjust: recordBrokerCashReconcileRow');
    // The reconcile row must not travel the transfer path that demands linkedCashAccountId.
    const fn = ctx.slice(
      ctx.indexOf('const recordBrokerCashReconcileRow'),
      ctx.indexOf('const getReconciliationOrchestratorDeps'),
    );
    expect(fn).toContain("from('investment_transactions')");
    expect(fn).not.toContain('linkedCashAccountId');
    expect(fn).not.toContain('recordTrade(');
    expect(fn).toContain('applyInvestmentAccountDeltaForTrade');
    expect(fn).toContain('sealHoldingsBookAfterTrade');
  });
});

describe('net worth snapshot revisions', () => {
  it('keeps the highest revision per day, newest day first', () => {
    const rows = [
      { id: 'a', snapshotDay: '2026-07-01', capturedAt: 'x', netWorth: 10, revision: 1 },
      { id: 'b', snapshotDay: '2026-07-01', capturedAt: 'y', netWorth: 20, revision: 2 },
      { id: 'c', snapshotDay: '2026-07-02', capturedAt: 'z', netWorth: 30, revision: 1 },
    ];
    const latest = latestRevisionPerDay(rows as any);
    expect(latest.map((r) => r.snapshotDay)).toEqual(['2026-07-02', '2026-07-01']);
    expect(latest.find((r) => r.snapshotDay === '2026-07-01')?.netWorth).toBe(20);
  });

  it('normalizes snake_case rows including bucket payloads', () => {
    const row = normalizeNetWorthSnapshotRevisionRow({
      id: 'r1',
      snapshot_day: '2026-07-26',
      captured_at: '2026-07-26T10:00:00.000Z',
      net_worth: 1234.5,
      sar_per_usd: 3.75,
      revision: 3,
      buckets: { cash: 1, investments: 2, physicalAndCommodities: 3, receivables: 4, liabilities: 5 },
    });
    expect(row.snapshotDay).toBe('2026-07-26');
    expect(row.revision).toBe(3);
    expect(row.buckets?.liabilities).toBe(5);
  });

  it('apply/reverse capture a revision and snapshot merge prefers restated days', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('captureSnapshotRevision');
    expect(orch).toContain('afterApplyRefresh');
    expect(orch).toContain('sealBookAfterAdjust');
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('insertNetWorthSnapshotRevision');
    expect(ctx).toContain('computePersonalHeadlineNetWorthSar');
    const snap = read('services/netWorthSnapshot.ts');
    expect(snap).toContain('fetchLatestNetWorthSnapshotRevisions');
    expect(snap).toContain('restatedDays');
  });
});

describe('audit surfaces + role gates + entry points', () => {
  it('orchestrator gates ownership and restricted roles on apply and reverse', () => {
    const src = read('services/reconciliation/orchestrator.ts');
    expect(src).toContain('assertOwnedEntity');
    expect(src).toContain('roleBlocksAdjustments');
    expect(src.split('roleBlocksAdjustments(deps.userRole)').length - 1).toBeGreaterThanOrEqual(2);
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('userRole: auth.userRole ?? null');
  });

  it('Accounts hides Reconcile for restricted roles and handles the palette action', () => {
    const page = read('pages/Accounts.tsx');
    expect(page).toContain('canReconcileBalances');
    expect(page).toContain('open-reconcile-balance');
    expect(page).not.toContain('onReconcileBalance={setReconcileAccount}');
  });

  it('command palette and statement import route to Reconcile Balance', () => {
    const palette = read('components/CommandPalette.tsx');
    expect(palette).toContain("triggerPageAction('Accounts', 'open-reconcile-balance')");
    expect(palette).toContain('reconciliation-audit-log');
    const statement = read('pages/StatementUpload.tsx');
    expect(statement).toContain('open-reconcile-balance');
    expect(statement).toContain('Reconcile Balance');
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toMatch(/case 'Accounts':[\s\S]{0,160}actionProps/);
  });

  it('holding quantity reconcile is reachable per holding, not via a first-holding guess', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('onReconcileQuantity');
    expect(page).toContain('Reconcile quantity…');
    expect(page).not.toContain('.find((h) => Number(h.quantity) > 0)');
  });

  it('dividend edit/delete write audit events', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain("'dividend_edit'");
    expect(ctx).toContain('edited (');
    expect(ctx).toContain('deleted (');
  });

  it('audit panel can refresh from the DB for multi-device trails', () => {
    const panel = read('components/reconciliation/ReconciliationAuditPanel.tsx');
    expect(panel).toContain('refreshReconciliationAudit');
    expect(panel).toContain('Refresh from DB');
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('fetchReconciliationAuditEvents');
    expect(ctx).toContain('fetchReconciliationAdjustments');
    expect(ctx).toContain('fetchReconciliationRuns');
  });

  it('backdated quantity reconcile records a replay run with real status', () => {
    const src = read('services/reconciliation/orchestrator.ts');
    expect(src).toContain('replayAffectedPortfolioSymbols');
    expect(src).toContain('buildReplayRunPayload');
    expect(src).toContain('status: replayStatus');
  });

  it('deep-links Notifications drift and Holdings integrity to entity-scoped reconcile', () => {
    const notifications = read('context/NotificationsContext.tsx');
    expect(notifications).toContain("pageLink: 'Accounts'");
    expect(notifications).toContain('open-reconcile-balance:');
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('onReconcileQuantity');
    expect(panel).toContain('Reconcile quantity');
    expect(read('utils/pageActions.ts')).toContain("page === 'Accounts'");
  });

  it('receivables and commodities expose Restate/Revalue; CA panel exposes Correct', () => {
    const liab = read('pages/Liabilities.tsx');
    expect(liab).toContain('onRestate');
    expect(liab).toContain('ReceivableCard');
    expect(liab).toMatch(/ReceivableCard[\s\S]{0,400}onRestate/);
    const commodities = read('pages/Commodities.tsx');
    expect(commodities).toContain('RevaluationModal');
    expect(commodities).toContain('onRevalue');
    const ca = read('components/investments/CorporateActionApplyPanel.tsx');
    expect(ca).toContain('onCorrect');
    expect(ca).toContain('Correct');
  });

  it('fee/VAT/deposit/withdrawal edits are allowed with cash cascade + audit', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain("'fee', 'vat', 'deposit', 'withdrawal'");
    expect(ctx).toContain("'fee_vat_edit'");
    expect(ctx).toMatch(/fee_vat_edit/);
  });

  it('buy/sell historical edits rebuild the symbol and cascade broker cash', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain("editableTradeTypes = new Set(['buy', 'sell'])");
    expect(ctx).toContain('rebuildHoldingsFromLedgerForSymbols');
    expect(ctx).toContain("mechanism");
    const page = read('pages/Investments.tsx');
    expect(page).toContain('canEditLedger');
    expect(page).toContain('Edit a specific buy/sell');
  });

  it('qty reconcile syncs lots without overwriting book quantity; audit can retry runs', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('syncLotsForSymbols');
    const panel = read('components/reconciliation/ReconciliationAuditPanel.tsx');
    expect(panel).toContain('retryReconciliationRun');
    expect(panel).toContain('Retry');
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('retryReconciliationRun');
    expect(ctx).toContain("functions.invoke('reconciliation-replay'");
  });

  it('stock_dividend / bonus shares are selectable in the CA wizard', () => {
    expect(read('services/corporateActionWizardModel.ts')).toContain("'stock_dividend'");
    expect(read('components/investments/corporateActions/CorporateActionWizard.tsx')).toContain(
      'Bonus / stock dividend',
    );
    expect(read('supabase/migrations/20260726140000_corporate_action_stock_dividend.sql')).toContain(
      'stock_dividend',
    );
  });

  it('Opening Balance is offered only when the ledger is empty', () => {
    const modal = read('components/reconciliation/ReconcileBalanceModal.tsx');
    expect(modal).toContain('opening_balance');
    expect(modal).toContain('accountHasLedgerActivity');
    expect(modal).toContain('Opening Balance');
    const accounts = read('pages/Accounts.tsx');
    expect(accounts).toContain('mechanism,');
  });

  it('Credit-linked liability Restate mirrors absolute credit balance', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('Math.abs(preview.actualValue)');
    expect(orch).toContain('Math.abs(targets.actualValue)');
  });

  it('managed owner entities are blocked from personal reconcile', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('isPersonalWealth');
    expect(orch).toContain('Managed wealth');
  });

  it('Sukuk and commodities lock book amounts after create', () => {
    expect(read('components/investments/SukukInvestmentsSection.tsx')).toContain('disabled={!!positionToEdit}');
    expect(read('pages/Commodities.tsx')).toContain('disabled={!!holdingToEdit}');
    expect(read('context/DataContext.tsx')).toContain('via Restate principal');
  });

  it('investment ledger edits write adjustment rows so audit Undo works', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('insertReconciliationAdjustment');
    expect(ctx).toContain('reverseInvestmentTransactionEdit');
    const panel = read('components/reconciliation/ReconciliationAuditPanel.tsx');
    expect(panel).toContain('Actor');
    expect(panel).toContain('Run');
  });

  it('Settings points to System Health reconciliation audit; Notifications deep-link qty drift', () => {
    expect(read('pages/Settings.tsx')).toContain('reconciliation-audit-log');
    expect(read('context/NotificationsContext.tsx')).toContain('open-reconcile-quantity:');
  });
});
