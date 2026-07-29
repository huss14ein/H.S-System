import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acknowledgeCashBalanceDriftDurable,
  acknowledgeHoldingsIntegrityDurable,
  expectedPostReconcileCashState,
  filterUnackedCashDriftWarnings,
  isCashBalanceDriftAcked,
  isInvestmentCashLedgerDriftAcked,
  mergeUiAcks,
  normalizeUiAcks,
  resolveCashBalanceDriftAcks,
  resolveHoldingsIntegrityAcks,
} from '../services/uiAcks';
import {
  filterUnackedDriftRows,
  loadHoldingsIntegrityAcks,
  saveHoldingsIntegrityAcks,
} from '../services/holdingsIntegrityAck';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('uiAcks durable reconcile dismissals', () => {
  const userId = 'ui-acks-user';
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
    saveHoldingsIntegrityAcks(userId, {});
  });

  afterEach(() => {
    saveHoldingsIntegrityAcks(userId, {});
    vi.unstubAllGlobals();
  });

  it('normalizeUiAcks keeps holdings + cash + investment KPI maps', () => {
    const n = normalizeUiAcks({
      holdingsQtyIntegrity: {
        'pf:AAPL': {
          portfolioId: 'pf',
          symbol: 'AAPL',
          kind: 'keep_stored',
          storedQtyFingerprint: 10,
          at: '2026-01-01T00:00:00.000Z',
        },
      },
      cashBalanceDrift: {
        acc1: { accountId: 'acc1', balanceFp: 100, netFp: 80, at: '2026-01-01T00:00:00.000Z' },
      },
      investmentCashLedgerDrift: { driftSarFp: 120, at: '2026-01-01T00:00:00.000Z' },
    });
    expect(n.holdingsQtyIntegrity?.['pf:AAPL']?.symbol).toBe('AAPL');
    expect(n.cashBalanceDrift?.acc1?.balanceFp).toBe(100);
    expect(n.investmentCashLedgerDrift?.driftSarFp).toBe(120);
  });

  it('mergeUiAcks replaces provided maps without dropping siblings', () => {
    const merged = mergeUiAcks(
      {
        holdingsQtyIntegrity: {
          'pf:A': {
            portfolioId: 'pf',
            symbol: 'A',
            kind: 'keep_stored',
            storedQtyFingerprint: 1,
            at: '2026-01-01T00:00:00.000Z',
          },
        },
        cashBalanceDrift: {
          c1: { accountId: 'c1', balanceFp: 10, netFp: 5, at: '2026-01-01T00:00:00.000Z' },
        },
      },
      {
        holdingsQtyIntegrity: {
          'pf:B': {
            portfolioId: 'pf',
            symbol: 'B',
            kind: 'keep_stored',
            storedQtyFingerprint: 2,
            at: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    );
    expect(merged.holdingsQtyIntegrity?.['pf:B']?.symbol).toBe('B');
    expect(merged.holdingsQtyIntegrity?.['pf:A']).toBeUndefined();
    expect(merged.cashBalanceDrift?.c1?.balanceFp).toBe(10);
  });

  it('normalizeUiAcks strips prototype pollution keys and caps growth', () => {
    const polluted: Record<string, unknown> = JSON.parse(
      '{"holdingsQtyIntegrity":{"__proto__":{"kind":"keep_stored","portfolioId":"x","symbol":"PWN","storedQtyFingerprint":1,"at":"2026-01-01T00:00:00.000Z"},"pf:OK":{"kind":"keep_stored","portfolioId":"pf","symbol":"OK","storedQtyFingerprint":1,"at":"2026-01-01T00:00:00.000Z"}}}',
    );
    const n = normalizeUiAcks(polluted);
    expect(n.holdingsQtyIntegrity?.['pf:OK']?.symbol).toBe('OK');
    expect((n.holdingsQtyIntegrity as any)?.__proto__?.symbol).toBeUndefined();
    expect(({} as any).PWN).toBeUndefined();

    const bulky: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) {
      bulky[`pf:S${i}`] = {
        kind: 'keep_stored',
        portfolioId: 'pf',
        symbol: `S${i}`,
        storedQtyFingerprint: i,
        at: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString(),
      };
    }
    const capped = normalizeUiAcks({ holdingsQtyIntegrity: bulky });
    expect(Object.keys(capped.holdingsQtyIntegrity ?? {}).length).toBeLessThanOrEqual(120);
  });

  it('DataContext does not block Apply on ui_acks upsert; skips qty-unchanged holding ack', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('Non-blocking: never stall Apply UX on settings upsert');
    expect(ctx).toContain('Skip align-lots / cost-only applies');
    expect(ctx).toContain('Math.abs(Number(input.actualValue) - holdingMeta.beforeQty) > 1e-6');
    expect(ctx).toContain('uiAcksPersistChainRef');
    expect(ctx).toContain('Optimistic local apply');
    expect(ctx).toContain('acknowledgeInvestmentCashLedgerDriftDurable');
  });

  it('settings uiAcks win over localStorage for holdings', () => {
    saveHoldingsIntegrityAcks(userId, {
      'pf:OLD': {
        portfolioId: 'pf',
        symbol: 'OLD',
        kind: 'keep_stored',
        storedQtyFingerprint: 1,
        at: '2026-01-01T00:00:00.000Z',
      },
    });
    const fromSettings = resolveHoldingsIntegrityAcks(userId, {
      uiAcks: {
        holdingsQtyIntegrity: {
          'pf:NEW': {
            portfolioId: 'pf',
            symbol: 'NEW',
            kind: 'keep_stored',
            storedQtyFingerprint: 5,
            at: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    }, { writeThrough: true });
    expect(Object.keys(fromSettings)).toEqual(['pf:NEW']);
    expect(loadHoldingsIntegrityAcks(userId)['pf:NEW']?.symbol).toBe('NEW');
  });

  it('resolveHoldingsIntegrityAcks does not write localStorage on hot paths by default', () => {
    saveHoldingsIntegrityAcks(userId, {});
    resolveHoldingsIntegrityAcks(userId, {
      uiAcks: {
        holdingsQtyIntegrity: {
          'pf:HOT': {
            portfolioId: 'pf',
            symbol: 'HOT',
            kind: 'keep_stored',
            storedQtyFingerprint: 1,
            at: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    });
    expect(loadHoldingsIntegrityAcks(userId)['pf:HOT']).toBeUndefined();
  });

  it('acknowledgeHoldingsIntegrityDurable merges onto settings map (does not drop siblings)', async () => {
    const existing = {
      holdingsQtyIntegrity: {
        'pf1:KEEP': {
          portfolioId: 'pf1',
          symbol: 'KEEP',
          kind: 'keep_stored' as const,
          storedQtyFingerprint: 3,
          at: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    const map = await acknowledgeHoldingsIntegrityDurable({
      userId,
      portfolioId: 'pf1',
      symbol: 'MSFT',
      kind: 'keep_stored',
      storedQty: 12,
      currentUiAcks: existing,
      persistUiAcks: async () => {},
    });
    expect(map['pf1:KEEP']?.symbol).toBe('KEEP');
    expect(map['pf1:MSFT']?.storedQtyFingerprint).toBe(12);
  });

  it('acknowledgeHoldingsIntegrityDurable writes local + calls persist', async () => {
    const persisted: unknown[] = [];
    const map = await acknowledgeHoldingsIntegrityDurable({
      userId,
      portfolioId: 'pf1',
      symbol: 'MSFT',
      kind: 'keep_stored',
      storedQty: 12,
      currentUiAcks: {},
      persistUiAcks: async (uiAcks) => {
        persisted.push(uiAcks);
      },
    });
    expect(map['pf1:MSFT']?.storedQtyFingerprint).toBe(12);
    expect(persisted).toHaveLength(1);
    expect((persisted[0] as any).holdingsQtyIntegrity['pf1:MSFT'].kind).toBe('keep_stored');
    expect(filterUnackedDriftRows([{ portfolioId: 'pf1', symbol: 'MSFT', storedQuantity: 12 }], map)).toEqual([]);
  });

  it('expectedPostReconcileCashState preserves drift magnitude while moving fingerprint', () => {
    const beforeBalance = 1000;
    const beforeNet = 700;
    const actualValue = 1200;
    const post = expectedPostReconcileCashState({ beforeBalance, actualValue, beforeTransactionNet: beforeNet });
    expect(post.storedBalance).toBe(1200);
    expect(post.transactionNet).toBe(900);
    expect(post.storedBalance - post.transactionNet).toBe(beforeBalance - beforeNet);
  });

  it('cash drift ack hides same fingerprint and resurfaces on new net', async () => {
    const map = await acknowledgeCashBalanceDriftDurable({
      userId,
      accountId: 'cash-1',
      storedBalance: 1200,
      transactionNet: 900,
      currentUiAcks: {},
    });
    expect(
      isCashBalanceDriftAcked({
        acks: map,
        accountId: 'cash-1',
        storedBalance: 1200,
        transactionNet: 900,
      }),
    ).toBe(true);
    const rows = [
      { accountId: 'cash-1', storedBalance: 1200, transactionNet: 900, showWarning: true },
      { accountId: 'cash-1', storedBalance: 1200, transactionNet: 850, showWarning: true },
    ];
    expect(filterUnackedCashDriftWarnings([rows[0]], map)).toEqual([]);
    expect(filterUnackedCashDriftWarnings([rows[1]], map)).toEqual([rows[1]]);
    expect(resolveCashBalanceDriftAcks(userId, { uiAcks: { cashBalanceDrift: map } })).toEqual(map);
  });

  it('investment KPI cash ledger ack fingerprints absolute drift', () => {
    expect(isInvestmentCashLedgerDriftAcked({ driftSarFp: 120.5, at: 'x' }, -120.5)).toBe(true);
    expect(isInvestmentCashLedgerDriftAcked({ driftSarFp: 120.5, at: 'x' }, 200)).toBe(false);
  });

  it('migration adds settings.ui_acks', () => {
    const sql = read('supabase/migrations/20260727180000_settings_ui_acks.sql');
    expect(sql).toContain('ui_acks');
    expect(sql).toContain('jsonb');
  });

  it('E2E: central apply + all prompt surfaces honor ui_acks', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('acknowledgeCashBalanceDriftAfterReconcile');
    expect(ctx).toContain('acknowledgeHoldingsIntegrityDurable');
    expect(ctx).toContain('mergeUiAcks');
    expect(ctx).toContain('uiAcks: {}');
    expect(ctx).toContain("'uiAcks' in settingsUpdate");

    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('acknowledgeHoldingsIntegrityDurable');
    expect(panel).toContain('resolveHoldingsIntegrityAcks');
    expect(panel).toContain('await updateSettings({ uiAcks: partial ?? {} })');
    expect(panel).not.toContain('mergeUiAcks(data?.settings?.uiAcks');

    const banner = read('components/accounts/CashBalanceDriftBanner.tsx');
    expect(banner).toContain('acknowledgeCashBalanceDriftDurable');
    expect(banner).toContain('Keep stored balance');
    expect(banner).toContain('await ctx.updateSettings({ uiAcks: partial })');
    expect(banner).not.toContain('mergeUiAcks(data.settings?.uiAcks');
    expect(read('pages/Accounts.tsx')).toContain('CashBalanceDriftBanner');

    const notif = read('context/NotificationsContext.tsx');
    expect(notif).toContain('filterUnackedCashDriftWarnings');
    expect(notif).toContain('reconcileCreditAccountBalance');
    expect(notif).toContain('filterUnackedDriftRows');

    const health = read('pages/SystemHealth.tsx');
    expect(health).toContain('filterUnackedCashDriftWarnings');
    expect(health).toContain('filterUnackedDriftRows');
    expect(health).toContain('acknowledgeCashBalanceDriftDurable');
    expect(health).toContain('acknowledgeInvestmentCashLedgerDriftDurable');
    expect(health).toContain('isInvestmentCashLedgerDriftAcked');
    expect(health).toContain('CREDIT_CARD_MIRROR_DRIFT');

    expect(read('types.ts')).toContain('uiAcks?:');
    expect(read('types.ts')).toContain('investmentCashLedgerDrift');
  });
});
