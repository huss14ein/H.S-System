/**
 * Credit card pay transfer — double-submit guard + pay-full-balance wiring on Accounts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('credit card pay transfer completion', () => {
  it('Accounts transfer submit is single-flight and disables while transferring', () => {
    const src = read('pages/Accounts.tsx');
    expect(src).toContain('transferSubmitLockRef');
    expect(src).toContain('isTransferSubmitting');
    expect(src).toContain("Transferring…");
    expect(src).toMatch(/disabled=\{isTransferSubmitting\}/);
    expect(src).toContain('if (transferSubmitLockRef.current || isTransferSubmitting) return');
    // Lock is set before validation / confirm so double-click cannot race
    const lockIdx = src.indexOf('transferSubmitLockRef.current = true');
    const confirmIdx = src.indexOf('confirmAction(');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(lockIdx);
  });

  it('Accounts exposes pay-full-balance per credit card and in the transfer modal', () => {
    const src = read('pages/Accounts.tsx');
    expect(src).toContain('Pay full balance');
    expect(src).toContain('Pay custom amount');
    expect(src).toContain('openPayCardTransfer');
    expect(src).toContain('applyFullCreditPayAmount');
    expect(src).toContain('resolveCreditCardAmountDue');
    expect(src).toContain('transferUseFullCreditBalance');
    expect(src).toContain('Pay cards from Checking or Savings');
    expect(src).toContain('open-pay-card');
    expect(src).toContain('creditCardMirrorMatches');
    expect(src).toContain('recurringTransferLockRef');
  });

  it('addTransfer blocks Investment→Credit and rejects in-flight duplicate keys', () => {
    const src = read('context/DataContext.tsx');
    expect(src).toContain('transferInFlightKeysRef');
    expect(src).toContain('Transfer already in progress');
    expect(src).toContain("fromAcc?.type === 'Investment' && toAcc?.type === 'Credit'");
  });

  it('system entry points reach Accounts pay-card action', () => {
    expect(read('utils/pageActions.ts')).toMatch(/open-pay-card/);
    expect(read('components/CommandPalette.tsx')).toContain("triggerPageAction('Accounts', 'open-pay-card')");
    expect(read('pages/Liabilities.tsx')).toContain('open-pay-card:');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('triggerPageAction={triggerPageAction}');
  });

  it('rewards statement credit reduces signed debt liability (does not Math.max to zero)', () => {
    const src = read('services/rewards/orchestrator.ts');
    expect(src).toContain('amount: roundMoney((Number(liab.amount) || 0) + fiatRounded)');
    expect(src).not.toContain('Math.max(0, (Number(liab.amount) || 0) - fiatRounded)');
  });

  it('credit liability restate mirrors signed balance onto the card account', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('balance: roundMoney(preview.actualValue)');
    expect(orch).not.toContain('Math.abs(preview.actualValue)');
  });

  it('confirm dialog ignores duplicate confirm clicks after resolve is cleared', () => {
    const src = read('hooks/useConfirmAction.tsx');
    expect(src).toContain('if (!resolveRef.current) return');
  });
});
