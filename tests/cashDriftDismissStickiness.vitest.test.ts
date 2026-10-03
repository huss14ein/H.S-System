/**
 * Balance-vs-ledger Keep stored / Reconcile dismissals must stay hidden for the same fingerprint
 * even when ledger rows use snake_case account_id or hydrate merges local acks.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, FinancialData, Transaction } from '../types';
import {
  reconcileCashAccountBalance,
  reconcileCreditAccountBalance,
  transactionNetForAccount,
} from '../services/dataQuality/accountReconciliation';
import { getPersonalTransactions } from '../utils/wealthScope';
import {
  acknowledgeCashBalanceDriftDurable,
  filterUnackedCashDriftWarnings,
  isCashBalanceDriftAcked,
  resolveCashBalanceDriftAcks,
  saveCashBalanceDriftAcks,
} from '../services/uiAcks';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('cash drift dismiss stickiness', () => {
  const userId = 'cash-drift-stick-user';
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    saveCashBalanceDriftAcks(userId, {});
  });

  afterEach(() => {
    saveCashBalanceDriftAcks(userId, {});
    vi.unstubAllGlobals();
  });

  it('Keep stored stays hidden when ledger mixes accountId + account_id', async () => {
    const account = { id: 'chk-1', name: 'Checking', type: 'Checking', balance: 418.61 } as Account;
    const txs = [
      { id: 'a', date: '2026-01-01', description: 'A', amount: -200, type: 'expense', category: 'Other', account_id: 'chk-1' },
      { id: 'b', date: '2026-01-02', description: 'B', amount: -201.52, type: 'expense', category: 'Other', accountId: 'chk-1' },
    ] as Transaction[];
    const rec = reconcileCashAccountBalance(account, txs);
    expect(rec?.showWarning).toBe(true);
    expect(transactionNetForAccount('chk-1', txs)).toBe(-401.52);

    const map = await acknowledgeCashBalanceDriftDurable({
      userId,
      accountId: account.id,
      storedBalance: rec!.storedBalance,
      transactionNet: rec!.transactionNet,
      currentUiAcks: {},
    });
    expect(
      isCashBalanceDriftAcked({
        acks: map,
        accountId: account.id,
        storedBalance: rec!.storedBalance,
        transactionNet: rec!.transactionNet,
      }),
    ).toBe(true);
    expect(filterUnackedCashDriftWarnings([{ ...rec!, showWarning: true }], map)).toEqual([]);

    /** Simulate hydrate with empty remote ui_acks — local dismissal must survive. */
    const afterHydrate = resolveCashBalanceDriftAcks(
      userId,
      { uiAcks: { cashBalanceDrift: {} } },
      { writeThrough: true },
    );
    expect(
      filterUnackedCashDriftWarnings([{ ...rec!, showWarning: true }], afterHydrate),
    ).toEqual([]);
  });

  it('credit card Keep stored fingerprints negative balances', async () => {
    const credit = {
      id: 'visa-1',
      name: 'Al-Rajhi Cashback Visa',
      type: 'Credit',
      balance: -3866.52,
    } as Account;
    const txs = [
      {
        id: 'c1',
        date: '2026-01-01',
        description: 'Spend',
        amount: -7380.52,
        type: 'expense',
        category: 'Other',
        account_id: 'visa-1',
      },
    ] as Transaction[];
    const rec = reconcileCreditAccountBalance(credit, txs);
    expect(rec?.showWarning).toBe(true);
    const map = await acknowledgeCashBalanceDriftDurable({
      userId,
      accountId: credit.id,
      storedBalance: rec!.storedBalance,
      transactionNet: rec!.transactionNet,
    });
    expect(filterUnackedCashDriftWarnings([{ ...rec!, showWarning: true }], map)).toEqual([]);
  });

  it('personal slice keeps snake_case rows when camelCase accountId is empty', () => {
    const data = {
      accounts: [{ id: 'chk-1', name: 'Checking', type: 'Checking', balance: 418.61 }],
      transactions: [
        { id: 'a', date: '2026-01-01', description: 'A', amount: -200, type: 'expense', category: 'Other', accountId: 'chk-1' },
        {
          id: 'b',
          date: '2026-01-02',
          description: 'B',
          amount: -201.52,
          type: 'expense',
          category: 'Other',
          accountId: '',
          account_id: 'chk-1',
        },
      ],
    } as unknown as FinancialData;
    const txs = getPersonalTransactions(data);
    expect(txs.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(transactionNetForAccount('chk-1', txs)).toBe(-401.52);
    const rec = reconcileCashAccountBalance(data.accounts[0] as Account, txs);
    expect(rec?.transactionNet).toBe(-401.52);
  });

  it('wires account_id-safe net + observed post-apply ack + hydrate merge', () => {
    const recon = read('services/dataQuality/accountReconciliation.ts');
    expect(recon).toContain('resolveTransactionAccountId');
    expect(read('utils/wealthScope.ts')).toMatch(/accountId \|\|[\s\S]*account_id|camel[\s\S]*account_id/);
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('observedBalance');
    expect(ctx).toContain('observedNet');
    expect(ctx).toContain('acknowledgeCashBalanceDriftDurable');
    expect(ctx).not.toContain('acknowledgeCashBalanceDriftAfterReconcile');
    expect(ctx).toContain('Merge durable local dismissals so hydrate never re-nags');
    expect(ctx).toContain('Prefer dataRef so concurrent optimistic uiAcks');
    const banner = read('components/accounts/CashBalanceDriftBanner.tsx');
    expect(banner).toContain('isBackgroundSyncing');
    expect(banner).toContain('persistChainRef');
    expect(banner).toContain('mergeUiAcks');
    expect(read('services/uiAcks.ts')).toContain('cashBalanceDriftAckChain');
    expect(read('services/uiAcks.ts')).toContain(
      'mergeCashBalanceDriftAckMapsByAt(prev.cashBalanceDrift',
    );
  });

  it('concurrent Keep stored on multiple accounts keeps every dismissal', async () => {
    const accounts = [
      { id: 'v1', name: 'Visa A', type: 'Credit', balance: -433.59 },
      { id: 'c1', name: 'Checking', type: 'Checking', balance: 2918.61 },
      { id: 'v2', name: 'Visa B', type: 'Credit', balance: -1754.73 },
      { id: 'c2', name: 'Checking 2', type: 'Checking', balance: 70963.98 },
    ] as Account[];
    const txs = [
      { id: 't1', date: '2026-01-01', description: 'A', amount: -3947.59, type: 'expense', category: 'Other', accountId: 'v1' },
      { id: 't2', date: '2026-01-01', description: 'B', amount: 2098.48, type: 'income', category: 'Income', accountId: 'c1' },
      { id: 't3', date: '2026-01-01', description: 'C', amount: -3657.51, type: 'expense', category: 'Other', accountId: 'v2' },
      { id: 't4', date: '2026-01-01', description: 'D', amount: 113983.98, type: 'income', category: 'Income', accountId: 'c2' },
    ] as Transaction[];

    const rows = accounts
      .map((a) =>
        a.type === 'Credit' ? reconcileCreditAccountBalance(a, txs) : reconcileCashAccountBalance(a, txs),
      )
      .filter((r): r is NonNullable<typeof r> => Boolean(r?.showWarning));
    expect(rows.length).toBe(4);

    /** Simulate racing Keep stored clicks (partial persist upserts). */
    const persisted: Array<Record<string, unknown>> = [];
    await Promise.all(
      rows.map((r) =>
        acknowledgeCashBalanceDriftDurable({
          userId,
          accountId: r.accountId,
          storedBalance: r.storedBalance,
          transactionNet: r.transactionNet,
          currentUiAcks: {},
          persistUiAcks: async (partial) => {
            persisted.push(partial as Record<string, unknown>);
          },
        }),
      ),
    );

    const finalLocal = resolveCashBalanceDriftAcks(userId, { uiAcks: {} }, { writeThrough: true });
    expect(filterUnackedCashDriftWarnings(rows.map((r) => ({ ...r, showWarning: true })), finalLocal)).toEqual(
      [],
    );
    expect(Object.keys(finalLocal).sort()).toEqual(['c1', 'c2', 'v1', 'v2']);

    /** Last persist must not wipe siblings when mergeUiAcks merges by account. */
    const { mergeUiAcks } = await import('../services/uiAcks');
    let settingsAcks = {};
    for (const partial of persisted) {
      settingsAcks = mergeUiAcks(settingsAcks, partial as any);
    }
    expect(
      filterUnackedCashDriftWarnings(
        rows.map((r) => ({ ...r, showWarning: true })),
        (settingsAcks as any).cashBalanceDrift ?? {},
      ),
    ).toEqual([]);
  });
});
