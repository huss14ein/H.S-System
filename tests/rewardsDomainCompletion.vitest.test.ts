/**
 * Rewards domain completion — wiring + behavior guards (phase E2E).
 * Trace: types → hydrate keys → DataContext hydrate → Rewards page → pageActions →
 * income/expense exclusion → memo NW value → Zakat exclusion.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FinancialData, RewardsAccount } from '../types';
import {
  sumRewardsFiatSar,
  sumRewardsZakatableSar,
  isRewardsLedgerCategory,
  REWARDS_STATEMENT_CREDIT_CATEGORY,
  REWARDS_CASH_DEPOSIT_CATEGORY,
  planFifoLotConsumption,
} from '../services/rewards';
import { bucketSumMatchesNetWorth } from '../services/netWorthReconciliation';
import { buildNotificationsDataFingerprint } from '../services/budgetSpendFingerprint';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeData(accounts: Partial<RewardsAccount>[]): FinancialData {
  return {
    rewardsAccounts: accounts.map((a, i) => ({
      id: a.id ?? `r${i}`,
      providerName: a.providerName ?? 'Qitaf',
      rewardType: a.rewardType ?? 'points',
      unitLabel: a.unitLabel ?? 'points',
      fiatCurrency: a.fiatCurrency ?? 'SAR',
      pointsPerFiatUnit: a.pointsPerFiatUnit ?? 100,
      currentBalance: a.currentBalance ?? 0,
      archived: a.archived ?? false,
    })) as RewardsAccount[],
    settings: {},
  } as unknown as FinancialData;
}

describe('rewardsDomainCompletion', () => {
  it('types.ts declares rewards + foundation shapes', () => {
    const types = read('types.ts');
    expect(types).toContain('export interface RewardsAccount');
    expect(types).toContain('export interface RewardsTransaction');
    expect(types).toContain('export interface RewardsTxLink');
    expect(types).toContain('rewardsAccounts?: RewardsAccount[]');
    expect(types).toContain('rewardsTransactions?: RewardsTransaction[]');
  });

  it('workspaceHydrateTiers registers rewards hydrate keys', () => {
    const tiers = read('services/workspaceHydrateTiers.ts');
    expect(tiers).toContain("'rewardsAccounts'");
    expect(tiers).toContain("'rewardsTransactions'");
    expect(tiers).toContain("'rewardsTxLinks'");
    expect(tiers).toContain("'rewardsLots'");
  });

  it('DataContext hydrates rewards tables via optional selects', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain("db.from('rewards_accounts')");
    expect(ctx).toContain("db.from('rewards_transactions')");
    expect(ctx).toContain('rewardsAccounts: patch.rewardsAccounts');
  });

  it('Rewards page exists and shows memo value via sumRewardsFiatSar', () => {
    const page = read('pages/Rewards.tsx');
    expect(page).toContain('sumRewardsFiatSar');
    expect(page).toContain('export default Rewards');
    expect(page).toMatch(/emergency\s*fund/i);
  });

  it('pageActions whitelists Rewards actions', () => {
    const actions = read('utils/pageActions.ts');
    expect(actions).toContain("page === 'Rewards'");
    expect(actions).toContain('open-create-reward');
    expect(actions).toContain('open-earn');
    expect(actions).toContain('open-redeem');
    expect(actions).toContain('open-rewards-expire');
  });

  it('rewards ledger categories are excluded from income/expense cashflow KPIs', () => {
    const filters = read('services/transactionFilters.ts');
    expect(filters).toContain('isRewardsLedgerCategory');
    expect(isRewardsLedgerCategory(REWARDS_STATEMENT_CREDIT_CATEGORY)).toBe(true);
    expect(isRewardsLedgerCategory(REWARDS_CASH_DEPOSIT_CATEGORY)).toBe(true);
    expect(isRewardsLedgerCategory('Salary')).toBe(false);
  });

  it('sumRewardsFiatSar values cash + points and honors NW toggle', () => {
    const data = makeData([
      { rewardType: 'cash', currentBalance: 250, fiatCurrency: 'SAR' },
      { rewardType: 'points', currentBalance: 10000, pointsPerFiatUnit: 100 },
    ]);
    // 250 cash + (10000 points / 100) = 250 + 100 = 350
    expect(sumRewardsFiatSar(data, 3.75)).toBe(350);
    expect(sumRewardsFiatSar(data, 3.75, { includeInNetWorth: false })).toBe(0);
  });

  it('rewards are always excluded from Zakat until redeemed (sumRewardsZakatableSar === 0)', () => {
    const data = makeData([{ rewardType: 'cash', currentBalance: 999999 }]);
    expect(sumRewardsZakatableSar(data, 3.75)).toBe(0);
  });

  it('Zakat page never sources its base from the rewards-inclusive NW breakdown', () => {
    const zakat = read('pages/Zakat.tsx');
    expect(zakat).not.toContain('computePersonalNetWorthBreakdownSAR');
    expect(zakat).not.toContain('sumRewardsFiatSar');
  });

  it('bucket reconciliation counts the rewards bucket so NW identity holds', () => {
    const buckets = {
      cash: 1000,
      investments: 2000,
      physicalAndCommodities: 0,
      receivables: 0,
      liabilities: -500,
      rewards: 350,
    };
    const nw = 1000 + 2000 - 500 + 350;
    const r = bucketSumMatchesNetWorth({ netWorth: nw, buckets });
    expect(r.matches).toBe(true);
    expect(r.componentsSum).toBe(nw);
    // Pre-rewards rows omit the bucket and also omit it from netWorth — identity still holds.
    const legacy = bucketSumMatchesNetWorth({
      netWorth: 2500,
      buckets: { ...buckets, rewards: undefined },
    });
    expect(legacy.matches).toBe(true);
  });

  it('rewards flow into the headline buckets, today snapshot, and are persisted on snapshots', () => {
    const nw = read('services/personalNetWorth.ts');
    expect(nw).toContain('rewardsSar: b.rewards ?? 0');
    const snap = read('services/netWorthSnapshot.ts');
    expect(snap).toMatch(/rewards\?: number/);
    const ext = read('services/netWorthSnapshotExtended.ts');
    expect(ext).toContain('buckets.rewards');
  });

  it('net worth composition surfaces render the rewards bucket', () => {
    const analytics = read('components/charts/NetWorthCompositionChart.tsx');
    expect(analytics).toContain('dataKey="Rewards"');
    expect(analytics).toContain('rewards: liveBuckets.rewards ?? 0');
    const dashboard = read('components/dashboard/NetWorthCompositionChart.tsx');
    expect(dashboard).toContain('buckets.rewards');
    const cockpit = read('components/charts/NetWorthCockpit.tsx');
    expect(cockpit).toContain('todaySnapshot.rewardsSar');
  });

  it('notifications recompute when rewards balances, expiry, or status change', () => {
    const fp = read('services/budgetSpendFingerprint.ts');
    expect(fp).toContain('rewardsAccounts?:');
    expect(fp).toContain('nearestRewardExpiryDays');
    expect(fp).toContain('incompleteRewards');
    const ctx = read('context/NotificationsContext.tsx');
    expect(ctx).toContain('data?.rewardsAccounts');
    expect(ctx).toContain('data?.rewardsTransactions');
  });

  it('fingerprint changes when a reward is earned or a redemption goes incomplete', () => {
    const base = { budgets: [], goals: [], transactions: [] };
    const empty = buildNotificationsDataFingerprint(base);
    const earned = buildNotificationsDataFingerprint({
      ...base,
      rewardsAccounts: [{ id: 'r1', currentBalance: 5000 }],
    });
    expect(earned).not.toBe(empty);
    const incomplete = buildNotificationsDataFingerprint({
      ...base,
      rewardsAccounts: [{ id: 'r1', currentBalance: 5000 }],
      rewardsTransactions: [{ id: 't1', status: 'incomplete' }],
    });
    expect(incomplete).not.toBe(earned);
  });

  it('a posted redemption can be reversed on both legs from the Rewards page', () => {
    const orch = read('services/rewards/orchestrator.ts');
    expect(orch).toContain('export async function reverseRewardsRedemption');
    // Ledger legs are undone before points are credited back.
    expect(orch.indexOf('deleteTransaction(link.financialTxId)')).toBeLessThan(
      orch.indexOf("idempotencyKey: `rewards_reverse:"),
    );
    expect(orch).toContain("status: 'reversed'");
    expect(orch).toContain('reversesTxId: original.id');
    const page = read('pages/Rewards.tsx');
    expect(page).toContain('reverseRewardsRedemption');
    expect(page).toContain('handleReverse');
  });

  it('reverse refuses when the ledger leg survives the delete attempt', () => {
    const orch = read('services/rewards/orchestrator.ts');
    expect(orch).toContain('Cash leg could not be removed');
    expect(orch).toContain('Investment leg could not be removed');
  });

  it('period locks block ordinary cash and investment mutations in DataContext', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('assertPeriodUnlocked');
    expect(ctx).toContain("add transactions");
    expect(ctx).toContain("edit transactions");
    expect(ctx).toContain("delete transactions");
    expect(ctx).toContain("record investment trades");
    expect(ctx).toContain("delete investment ledger rows");
    expect(ctx).toContain("edit investment ledger rows");
    expect(ctx).toContain("move investment ledger rows into");
  });

  it('Dashboard and Goals surface available liquidity from canonical metrics', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toContain("title=\"Available Liquidity\"");
    expect(dash).toContain('availableLiquiditySar');
    const goals = read('pages/Goals.tsx');
    expect(goals).toContain('availableLiquiditySar');
    expect(goals).toContain('Available liquidity');
  });

  it('Settings exposes emergencyFundMonthsTarget and emergency fund metrics honor it', () => {
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('emergencyFundMonthsTarget');
    const ef = read('hooks/useEmergencyFund.ts');
    expect(ef).toContain('emergencyFundMonthsTarget');
  });

  it('rewards net-worth toggle and emergency-fund target persist to the settings row', () => {
    const ctx = read('context/DataContext.tsx');
    // Written on save, not just hydrated on read.
    expect(ctx).toContain('row.include_rewards_in_net_worth');
    expect(ctx).toContain('row.emergency_fund_months_target');
    expect(ctx).toContain('clampEmergencyFundMonthsTarget');
    const migration = read('supabase/migrations/20260726210000_settings_rewards_and_emergency_fund.sql');
    expect(migration).toContain('add column if not exists include_rewards_in_net_worth');
    expect(migration).toContain('add column if not exists emergency_fund_months_target');
    expect(migration).not.toMatch(/drop\s+table|truncate|drop\s+column/i);
  });

  it('earn opens FIFO lots and redeem consumes them; transfer UI exists', () => {
    const orch = read('services/rewards/orchestrator.ts');
    expect(orch).toContain("from('rewards_lots')");
    expect(orch).toContain('planFifoLotConsumption');
    expect(orch).toContain("transactionType === 'transfer_in'");
    // FIFO is planned before insert/balance mutation when open lots exist.
    expect(orch.indexOf('fifoPlan = planFifoLotConsumption')).toBeLessThan(
      orch.indexOf('const inserted = await insertRewardTx'),
    );
    const domain = read('services/rewards/rewardsDomain.ts');
    expect(domain).toContain('export function planFifoLotConsumption');
    const page = read('pages/Rewards.tsx');
    expect(page).toContain('transferRewards');
    expect(page).toContain('Transfer between rewards accounts');
  });

  it('planFifoLotConsumption is soonest-expiry-first and rejects short lots', () => {
    const lots = [
      {
        id: 'late',
        accountId: 'a1',
        earnTxId: 'e2',
        quantityRemaining: 40,
        expiresOn: '2026-12-01',
        createdAt: '2026-01-02',
      },
      {
        id: 'soon',
        accountId: 'a1',
        earnTxId: 'e1',
        quantityRemaining: 30,
        expiresOn: '2026-08-01',
        createdAt: '2026-01-01',
      },
    ];
    const ok = planFifoLotConsumption(lots as any, 'a1', 50);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.updates).toEqual([
        { id: 'soon', quantityRemaining: 0 },
        { id: 'late', quantityRemaining: 20 },
      ]);
    }
    const short = planFifoLotConsumption(lots as any, 'a1', 100);
    expect(short.ok).toBe(false);
  });

  it('HoldingLotsPanel is on the main holding detail modal', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain("import HoldingLotsPanel");
    expect(inv).toContain('<HoldingLotsPanel');
  });

  it('rewards-expiry-scan requires a cron secret (no anon service-role abuse)', () => {
    const fn = read('supabase/functions/rewards-expiry-scan/index.ts');
    expect(fn).toContain('REWARDS_EXPIRY_SCAN_SECRET');
    expect(fn).toContain('x-rewards-expiry-secret');
    expect(fn).toContain("status: 401");
    expect(fn).toContain('.eq(\'user_id\', lot.user_id)');
  });

  it('redeem compensation restores lots via reversesTxId; Rewards busy uses try/finally', () => {
    const orch = read('services/rewards/orchestrator.ts');
    expect(orch).toContain('Compensating reverse — ledger leg failed');
    expect(orch).toContain('reversesTxId: posted.tx.id');
    expect(orch).toContain('Promise.all');
    const page = read('pages/Rewards.tsx');
    expect(page).toContain('} finally {');
    expect(page).toContain('setBusy(false)');
  });

  it('async canonical metrics merge liquidity slices and overlay preserves them', () => {
    const asyncPath = read('services/canonicalFinancialMetricsAsync.ts');
    expect(asyncPath).toContain('computeLiquiditySlices');
    const overlay = read('hooks/canonicalFinancialMetricsBundle.ts');
    expect(overlay).toContain('availableLiquiditySar: live.availableLiquiditySar');
    expect(overlay).toContain('rewardsSar: live.rewardsSar');
  });
});
