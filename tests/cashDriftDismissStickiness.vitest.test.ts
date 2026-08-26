/**
 * Balance-vs-ledger Keep stored / Reconcile dismissals must stay hidden for the same fingerprint
 * even when ledger rows use snake_case account_id or hydrate merges local acks.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, Transaction } from '../types';
import {
  reconcileCashAccountBalance,
  reconcileCreditAccountBalance,
  transactionNetForAccount,
} from '../services/dataQuality/accountReconciliation';
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
  });
});
