/**
 * Keep stored / Keep closed acknowledgments for holdings qty integrity panel.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acknowledgeHoldingsIntegrity,
  filterUnackedDriftRows,
  filterUnackedMissingRows,
  holdingsIntegrityAckKey,
  isHoldingsIntegrityAcked,
  loadHoldingsIntegrityAcks,
  saveHoldingsIntegrityAcks,
} from '../services/holdingsIntegrityAck';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('holdingsIntegrityAck', () => {
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
  });

  it('Keep stored ack dismisses matching drift row and invalidates when qty changes', () => {
    const userId = 'user-1';
    acknowledgeHoldingsIntegrity({
      userId,
      portfolioId: 'pf1',
      symbol: 'LARGE.CAP',
      kind: 'keep_stored',
      storedQty: 295.418,
    });
    const acks = loadHoldingsIntegrityAcks(userId);
    expect(
      isHoldingsIntegrityAcked({
        acks,
        portfolioId: 'pf1',
        symbol: 'LARGE.CAP',
        kind: 'keep_stored',
        storedQty: 295.418,
      }),
    ).toBe(true);

    const rows = [
      { portfolioId: 'pf1', symbol: 'LARGE.CAP', storedQuantity: 295.418 },
      { portfolioId: 'pf1', symbol: '4163.SR', storedQuantity: 10 },
    ];
    expect(filterUnackedDriftRows(rows, acks)).toEqual([
      { portfolioId: 'pf1', symbol: '4163.SR', storedQuantity: 10 },
    ]);

    // After a trade changes stored qty, ack no longer matches — drift resurfaces.
    expect(
      filterUnackedDriftRows([{ portfolioId: 'pf1', symbol: 'LARGE.CAP', storedQuantity: 300 }], acks),
    ).toHaveLength(1);
  });

  it('Keep closed ack dismisses matching ledger-net missing row and invalidates when ledger changes', () => {
    const userId = 'user-1';
    acknowledgeHoldingsIntegrity({
      userId,
      portfolioId: 'pf-awaed',
      symbol: 'ATYR',
      kind: 'keep_closed',
      storedQty: 60,
    });
    const acks = loadHoldingsIntegrityAcks(userId);
    const missing = [
      { portfolioId: 'pf-awaed', symbol: 'ATYR', ledgerNet: 60 },
      { portfolioId: 'pf-awaed', symbol: 'AIIO', ledgerNet: 10 },
    ];
    expect(filterUnackedMissingRows(missing, acks).map((r) => r.symbol)).toEqual(['AIIO']);

    // Later buys change ledger net — keep_closed must not permanently hide the gap.
    expect(
      filterUnackedMissingRows(
        [{ portfolioId: 'pf-awaed', symbol: 'ATYR', ledgerNet: 160 }],
        acks,
      ),
    ).toHaveLength(1);
  });

  it('ack key normalizes symbol case', () => {
    expect(holdingsIntegrityAckKey('pf1', 'atyR')).toBe('pf1:ATYR');
  });

  it('save/load round-trip', () => {
    saveHoldingsIntegrityAcks('u', {
      'pf1:X': {
        portfolioId: 'pf1',
        symbol: 'X',
        kind: 'keep_stored',
        storedQtyFingerprint: 1,
        at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(loadHoldingsIntegrityAcks('u')['pf1:X']?.symbol).toBe('X');
  });

  it('panel wires Keep stored to acknowledgeHoldingsIntegrity + toast (not message-only)', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('acknowledgeHoldingsIntegrity');
    expect(panel).toContain("kind: 'keep_stored'");
    expect(panel).toContain("kind: 'keep_closed'");
    expect(panel).toContain('filterUnackedDriftRows');
    expect(panel).toContain('filterUnackedMissingRows');
    expect(panel).toContain('data-testid={`keep-stored-');
    expect(panel).toContain("toast(");
    expect(panel).toContain('cursor-pointer');
    // Must not be the old no-op that only setRebuildMessage.
    expect(panel).not.toContain('No ledger rebuild.');
  });

  it('Investments and SystemHealth still mount integrity panel; KPIs use stored quantity', () => {
    expect(read('pages/Investments.tsx')).toContain('HoldingsQtyIntegrityPanel');
    expect(read('pages/SystemHealth.tsx')).toContain('HoldingsQtyIntegrityPanel');
    expect(read('utils/holdingValuation.ts')).toContain('Number(h.quantity');
    expect(read('services/canonicalFinancialMetrics.ts')).toContain(
      'computeHeadlinePersonalInvestmentRoiDecimal',
    );
  });
});
