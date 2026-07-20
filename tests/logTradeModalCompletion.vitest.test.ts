/**
 * Log a Trade (quick action) → Record Trade modal — E2E wiring + consume semantics.
 * Trace: QuickActionsSidebar → Layout triggerPageAction → Investments open-trade-modal
 * → setIsTradeModalOpen(true) → scheduleClearPageAction (Strict Mode safe).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scheduleClearPageAction } from '../utils/scheduleClearPageAction';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('logTradeModalCompletion', () => {
  it('Quick Actions Log a Trade dispatches open-trade-modal on Investments', () => {
    const qa = read('components/QuickActionsSidebar.tsx');
    expect(qa).toContain("name: 'Log a Trade'");
    expect(qa).toContain("action: 'open-trade-modal'");
    expect(qa).toContain("page: 'Investments'");
    expect(read('components/Layout.tsx')).toContain('QuickActionsSidebar onAction={triggerPageAction}');
  });

  it('Investments opens Record Trade modal for open-trade-modal and delays clear', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain("pageAction.startsWith('open-trade-modal')");
    expect(inv).toContain('setIsTradeModalOpen(true)');
    expect(inv).toContain('scheduleClearPageAction(clearPageAction)');
    expect(inv).toContain('<RecordTradeModal');
    expect(inv).toContain('isOpen={isTradeModalOpen}');
    // Must not clear synchronously (Strict Mode remount would wipe modal state).
    const openBlock = inv.slice(
      inv.indexOf("if (pageAction.startsWith('open-trade-modal'))"),
      inv.indexOf("if (pageAction === 'focus-investment-plan')"),
    );
    expect(openBlock).not.toMatch(/clearPageAction\?\.\(\)/);
    expect(openBlock).toContain('return scheduleClearPageAction(clearPageAction)');
  });

  it('shell prefers pageAction over tabAction and uses stable route key', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain('const effectivePageAction = pageAction ?? tabAction');
    expect(shell).toContain('const routeKey = shell;');
  });

  it('Save & Record Trade from Transactions targets Investments (not Dashboard)', () => {
    const tx = read('pages/Transactions.tsx');
    expect(tx).toContain("triggerPageAction('Investments', `open-trade-modal:with-amount:");
    expect(tx).not.toContain("triggerPageAction('Dashboard', `open-trade-modal:with-amount:");
  });

  it('shell re-fires identical pageAction so Log a Trade works when already on Investments', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain('prev === action');
    expect(shell).toContain('queueMicrotask(() => setPageAction(action))');
  });

  it('scheduleClearPageAction cancels on cleanup (Strict Mode remount safe)', () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    const cancel = scheduleClearPageAction(clear);
    cancel();
    vi.runAllTimers();
    expect(clear).not.toHaveBeenCalled();

    const clear2 = vi.fn();
    scheduleClearPageAction(clear2);
    vi.runAllTimers();
    expect(clear2).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
