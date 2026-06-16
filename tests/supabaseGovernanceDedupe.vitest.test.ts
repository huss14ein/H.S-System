/**
 * Guards duplicate Supabase governance reads that caused network lag on hydrate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('supabase governance query dedupe E2E', () => {
  it('NotificationsContext uses AuthContext isAdmin and cached head counts (not users role fetch)', () => {
    const src = read('context/NotificationsContext.tsx');
    expect(src).toContain('auth.isAdmin');
    expect(src).not.toMatch(/from\(['"]users['"]\)[\s\S]{0,80}select\(['"]role['"]\)/);
    expect(src).toContain('cachedSupabaseHeadCount');
    expect(src).toContain('showHydrateBanner');
    expect(src).toContain('scheduleIdleWork');
  });

  it('shared accounts RPC is cached and reused by Accounts + Transactions', () => {
    expect(read('services/sharedAccountsRpc.ts')).toContain('fetchSharedAccountsForMe');
    expect(read('pages/Accounts.tsx')).toContain('fetchSharedAccountsForMe');
    expect(read('pages/Transactions.tsx')).toContain('fetchSharedAccountsForMe');
    expect(read('pages/Accounts.tsx')).not.toContain("rpc('get_shared_accounts_for_me')");
  });

  it('pending admin transactions RPC is cached and not re-fetched on every transaction hydrate', () => {
    const tx = read('pages/Transactions.tsx');
    expect(tx).toContain('fetchPendingTransactionsForAdmin');
    expect(tx).toContain('invalidatePendingTransactionsCache');
    expect(tx).not.toContain('data?.transactions, pendingRefreshKey');
    expect(tx).toContain('auth?.isAdmin');
    expect(tx).not.toMatch(/from\(['"]users['"]\)[\s\S]{0,80}select\(['"]role['"]\)/);
  });

  it('Budgets and Summary use AuthContext isAdmin instead of redundant users role select', () => {
    expect(read('pages/Budgets.tsx')).toContain('auth.isAdmin');
    expect(read('pages/Budgets.tsx')).not.toMatch(/from\(['"]users['"]\)[\s\S]{0,80}select\(['"]role['"]\)/);
    expect(read('pages/Summary.tsx')).toContain('auth?.isAdmin');
    expect(read('pages/Summary.tsx')).not.toMatch(/from\(['"]users['"]\)[\s\S]{0,80}select\(['"]role['"]\)/);
  });

  it('AuthContext clears supabase query cache on sign out', () => {
    expect(read('context/AuthContext.tsx')).toContain('invalidateSupabaseQueryCache');
    expect(read('context/AuthContext.tsx')).toContain("event === 'SIGNED_OUT'");
  });
});
