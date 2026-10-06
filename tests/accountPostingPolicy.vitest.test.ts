import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canPostTransactionToAccount } from '../services/dataQuality/accountPostingPolicy';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('canPostTransactionToAccount', () => {
  it('allows credit accounts even when type casing is inconsistent and balance is zero', () => {
    const out = canPostTransactionToAccount({
      id: 'cc-1',
      type: 'credit' as any,
      balance: 0,
    });
    expect(out.allowed).toBe(true);
  });

  it('blocks expenses on non-credit zero-balance accounts', () => {
    const out = canPostTransactionToAccount(
      {
        id: 'chk-1',
        type: 'Checking',
        balance: 0,
      },
      { transactionType: 'expense', category: 'Food & Dining' },
    );
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/Expenses are blocked/i);
  });

  it('blocks expenses on zero-balance Savings', () => {
    const out = canPostTransactionToAccount(
      { id: 'sav-1', type: 'Savings', balance: 0 },
      { transactionType: 'expense', category: 'Shopping' },
    );
    expect(out.allowed).toBe(false);
  });

  it('allows income (salary) onto zero/negative checking so accounts can be funded', () => {
    const zero = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Income' },
    );
    expect(zero.allowed).toBe(true);

    const negative = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: -50 },
      { transactionType: 'income', category: 'Salary' },
    );
    expect(negative.allowed).toBe(true);
  });

  it('allows inbound transfer income onto zero-balance checking', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Transfer' },
    );
    expect(out.allowed).toBe(true);
  });

  it('blocks outgoing transfer expense from zero-balance checking', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'expense', category: 'Transfer' },
    );
    expect(out.allowed).toBe(false);
  });

  it('allows expenses when checking balance is positive', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 100 },
      { transactionType: 'expense', category: 'Food & Dining' },
    );
    expect(out.allowed).toBe(true);
  });

  it('allows reconciliation adjustment onto zero-balance checking', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Reconciliation Adjustment' },
    );
    expect(out.allowed).toBe(true);
  });

  it('allows opening-balance reconcile category even typed as expense on zero balance', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'expense', category: 'Opening Balance' },
    );
    expect(out.allowed).toBe(true);
  });

  it('blocks expense when transaction type is omitted on zero-balance checking', () => {
    const out = canPostTransactionToAccount({
      id: 'chk-1',
      type: 'Checking',
      balance: 0,
    });
    expect(out.allowed).toBe(false);
  });

  it('rejects missing account', () => {
    const out = canPostTransactionToAccount(undefined, {
      transactionType: 'income',
      category: 'Salary',
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/Account not found/i);
  });
});

describe('accountPostingPolicy wiring (DataContext)', () => {
  it('gates addTransaction and updateTransaction before writes; Apply recurring checks success', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('canPostTransactionToAccount');
    expect(ctx).toContain("transactionType: transaction.type === 'income' ? 'income' : 'expense'");
    expect(ctx).toMatch(/Promise<boolean>/);
    expect(ctx).toContain('if (!ok) return { applied: false, skipped: true }');
    expect(ctx).toContain('if (!ok) continue');
    // updateTransaction must check policy before DB update (not after).
    const updateIdx = ctx.indexOf('const updateTransaction = async');
    const policyInUpdate = ctx.indexOf('canPostTransactionToAccount(postingAccount', updateIdx);
    const dbUpdate = ctx.indexOf(".update(variants[i])", updateIdx);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(policyInUpdate).toBeGreaterThan(updateIdx);
    expect(dbUpdate).toBeGreaterThan(policyInUpdate);
  });

  it('skips balance posting policy only for SMS/statement replay, not system recurring writes', () => {
    const ctx = read('context/DataContext.tsx');
    const addIdx = ctx.indexOf('const addTransaction = async');
    const addSlice = ctx.slice(addIdx, addIdx + 2800);
    expect(addSlice).toContain('SMS/statement replay reflects bank history');
    const addPolicy = addSlice.slice(addSlice.indexOf('SMS/statement replay reflects bank history'));
    expect(addPolicy).toMatch(/if\s*\(!opts\?\.statementReplay\)\s*\{[\s\S]*?canPostTransactionToAccount/);
    expect(addPolicy).not.toMatch(/\)\?\.system\)/);

    const xferIdx = ctx.indexOf('const addTransfer = async');
    const updateIdx = ctx.indexOf('const updateTransaction = async');
    const xferSlice = ctx.slice(xferIdx, updateIdx);
    expect(xferSlice).toContain('SMS/statement replay may post history');
    expect(xferSlice).toMatch(/if\s*\(!opts\?\.statementReplay\)\s*\{[\s\S]*?canPostTransactionToAccount/);
    expect(xferSlice).toContain('linkedLedgerOpts');
    expect(xferSlice).not.toMatch(/\)\?\.system\)/);

    const recurringIdx = ctx.indexOf('const applyRecurringRuleForMonth');
    const recurringEnd = ctx.indexOf('const applyRecurringForMonth', recurringIdx);
    const recurringSlice = ctx.slice(recurringIdx, recurringEnd);
    expect(recurringSlice).toContain('{ system: true }');
    expect(recurringSlice).not.toContain('statementReplay');

    const dueIdx = ctx.indexOf('const applyRecurringDueToday');
    const dueEnd = ctx.indexOf('// Auto-apply recurring transactions due today', dueIdx);
    const dueSlice = ctx.slice(dueIdx, dueEnd);
    expect(dueSlice).toContain('{ system: true }');
    expect(dueSlice).not.toContain('statementReplay');

    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('statementReplay: true');
    expect(stmt).toContain('statementReplayOpts');
  });
});
