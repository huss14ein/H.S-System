/**
 * Bugbot E2E guards: sequential trade patches, awaited holdings rebuild on edit,
 * market_quote_cache seed retries when auth becomes ready.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('tradePatchAndQuoteSeedCompletion', () => {
  it('recordTrade applies cash then position sequentially (no parallel patch race)', () => {
    const ctx = read('context/DataContext.tsx');
    // Prefer the buy/sell block that owns position delta (not dividend-only branches).
    const marker = 'const deltaResult = await applyPositionDeltaForTrade';
    const posIdx = ctx.indexOf(marker);
    expect(posIdx).toBeGreaterThan(-1);
    const blockStart = ctx.lastIndexOf("if (tradeData.type === 'buy' || tradeData.type === 'sell')", posIdx);
    const blockEnd = ctx.indexOf('const runLotSync = async', posIdx);
    const block = ctx.slice(blockStart, blockEnd);
    expect(block).toContain('await applyInvestmentAccountDeltaForTrade');
    expect(block).toContain(marker);
    expect(block).not.toContain('Promise.all([cashWrite, positionWrite])');
    expect(ctx).toContain('schedule a stale setData snapshot');
  });

  it('investment TX edit awaits holdings rebuild before return', () => {
    const ctx = read('context/DataContext.tsx');
    const start = ctx.indexOf('const updateInvestmentTransaction = async');
    expect(start).toBeGreaterThan(-1);
    const end = ctx.indexOf('const deleteInvestmentTransaction = async', start);
    const block = ctx.slice(start, end);
    expect(block).toContain('await rebuildHoldingsFromLedgerForSymbols');
    // Rebuild must not live only inside the background lotSyncChain task.
    const rebuildIdx = block.indexOf('await rebuildHoldingsFromLedgerForSymbols');
    const chainIdx = block.indexOf('enqueueLotSyncWork(runPostEditWork)');
    expect(rebuildIdx).toBeGreaterThan(-1);
    expect(chainIdx).toBeGreaterThan(rebuildIdx);
    expect(block.slice(0, chainIdx)).toContain('await rebuildHoldingsFromLedgerForSymbols');
    expect(block.slice(chainIdx)).not.toContain('await rebuildHoldingsFromLedgerForSymbols');
  });

  it('MarketSimulator retries market_quote_cache seed when auth.user.id becomes ready', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('lastQuoteDbSeedUserIdRef');
    expect(sim).toContain('lastQuoteDbSeedUserIdRef.current === authUserId');
    expect(sim).toContain('seedQuoteCacheFromMarketQuoteDb');
    expect(sim).toContain('auth?.user?.id');
    // Must not permanently lock after a no-auth local-only pass.
    expect(sim).not.toMatch(
      /if \(!data \|\| showHydrateBanner \|\| didAlignHoldingsFromCacheRef\.current\) return;/,
    );
  });

  it('applyFinancialDataPatch drops stale startTransition commits via epoch guard', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('dataPatchEpochRef');
    expect(ctx).toContain('committedPatchEpochRef');
    expect(ctx).toContain('if (epoch !== dataPatchEpochRef.current) return prev');
    expect(ctx).toContain('committedPatchEpochRef.current = epoch');
    expect(ctx).toContain('if (committedPatchEpochRef.current < dataPatchEpochRef.current) return');
    expect(ctx).toContain('enqueueLotSyncWork');
    expect(ctx).toContain('await enqueueLotSyncWork(async () => {');
    const sealStart = ctx.indexOf('const sealHoldingsBookAfterTrade = ');
    const sealBody = ctx.slice(sealStart, sealStart + 700);
    expect(sealBody).toContain('scheduleIdleWork(write, 0)');
    expect(sealBody).not.toContain('4000');
  });

  it('lot sync after trade patches realized_pnl without rewriting quantity', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('patchHoldingRealizedPnL');
    expect(ctx).toContain('.update({ realized_pnl: rounded })');
    const sync = read('services/portfolioLedgerSync.ts');
    expect(sync).toContain('patchHoldingRealizedPnL?:');
    expect(sync).toContain('stale pre-sell quantity');
  });
});
