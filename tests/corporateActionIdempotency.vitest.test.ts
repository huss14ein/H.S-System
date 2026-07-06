/**
 * Corporate action idempotency — duplicate apply is a no-op (B5).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCorporateActionIdempotencyKey } from '../services/corporateActions';
import { buildCorporateActionEventPayload } from '../services/corporateActionApply';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('corporateActionIdempotency', () => {
  it('builds stable idempotency keys for identical corporate actions', () => {
    const args = {
      portfolioId: 'p1',
      symbol: 'AAPL',
      executionDate: '2026-06-01',
      action: { type: 'stock_split' as const, ratioNumerator: 2, ratioDenominator: 1 },
    };
    const a = buildCorporateActionEventPayload(args).idempotency_key;
    const b = buildCorporateActionEventPayload(args).idempotency_key;
    expect(a).toBe(b);
    expect(a).toContain('portfolioId=p1');
    expect(a).toContain('symbol=AAPL');
  });

  it('idempotency key helper is deterministic', () => {
    const key = buildCorporateActionIdempotencyKey({
      portfolioId: 'p1',
      symbol: '2222.SR',
      type: 'reverse_stock_split',
      date: '2026-06-15',
      num: 1,
      den: 10,
    });
    expect(key).toBe(
      buildCorporateActionIdempotencyKey({
        portfolioId: 'p1',
        symbol: '2222.SR',
        type: 'reverse_stock_split',
        date: '2026-06-15',
        num: 1,
        den: 10,
      }),
    );
  });

  it('DataContext returns early on duplicate insert without replay sync', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain("if (error.code === '23505')");
    expect(ctx).toContain('return;');
    expect(ctx).toMatch(/23505[\s\S]{0,120}return;/);
    expect(ctx).toContain('syncPortfolioLedgerAfterChange');
    expect(ctx).not.toMatch(/23505[\s\S]{0,400}persistHoldingsFromReplayMap/);
  });
});
