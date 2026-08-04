/**
 * Manual + Household bulk budget create — E2E wiring.
 * Trace: BudgetModal confirm → handleSaveBudget → addBudget({ confirmed: true })
 *        with snake_case-only insert payload (never camelCase goalId / destinationAccountId).
 * Household bulk: window.confirm once → addBudget(..., { confirmed: true }) per row
 *        so guardRecordWrite does not re-prompt and stall the loop.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('budgetAddCompletion', () => {
  it('addBudget builds DB columns only (no camelCase spread into insert)', () => {
    const ctx = read('context/DataContext.tsx');
    const start = ctx.indexOf('const addBudget = async');
    const end = ctx.indexOf('const updateBudget = async', start);
    const body = ctx.slice(start, end);
    expect(body).toContain("user_id: auth.user.id");
    expect(body).toContain('payload.goal_id');
    expect(body).toContain('destination_account_id');
    expect(body).not.toMatch(/\{\s*\.\.\.withUser\(budget\)/);
    expect(body).not.toMatch(/insert\(\s*withUser/);
  });

  it('BudgetModal awaits save and only closes after success', () => {
    const budgets = read('pages/Budgets.tsx');
    const modalStart = budgets.indexOf('const handleSubmit = async (e: React.FormEvent)');
    const modalEnd = budgets.indexOf('return (', modalStart);
    const submit = budgets.slice(modalStart, modalEnd);
    expect(submit).toContain('await onSave(');
    expect(submit).toContain('onClose()');
    expect(submit).toMatch(/catch\s*\{[\s\S]*return;/);
    const save = budgets.slice(
      budgets.indexOf('const handleSaveBudget = async'),
      budgets.indexOf('const handleShareBudget'),
    );
    expect(save).toContain('if (!ok)');
    expect(save).toContain('throw new Error');
  });

  it('manual save and household bulk pass confirmed: true', () => {
    const budgets = read('pages/Budgets.tsx');
    expect(budgets).toContain('await addBudget(budget, { confirmed: true })');
    expect(budgets).toMatch(
      /await addBudget\(\s*\{\s*category: cat\.category[\s\S]*?\{\s*confirmed:\s*true\s*\}/,
    );
  });

  it('yearly budgets expose anchor month picker; updateBudget matches by id', () => {
    const budgets = read('pages/Budgets.tsx');
    const ctx = read('context/DataContext.tsx');
    expect(budgets).toContain('yearly-anchor-month');
    expect(budgets).toContain('Month this yearly budget is used');
    expect(ctx).toContain('.match({ id, user_id: auth.user.id })');
    expect(ctx).toContain('Could not find that budget to update');
  });

  it('finalize request and smart-fill skip double-confirm and await saves', () => {
    const budgets = read('pages/Budgets.tsx');
    expect(budgets).toMatch(
      /await addBudget\(\s*\{[\s\S]*?tier:\s*'Optional',[\s\S]*?\{\s*confirmed:\s*true\s*\}/,
    );
    expect(budgets).toContain('{ confirmed: true }');
    const smart = budgets.slice(
      budgets.indexOf('const handleSmartFillBudgets'),
      budgets.indexOf('const handleSuggestBudgetAdjustments'),
    );
    expect(smart).toContain('{ confirmed: true }');
    expect(smart).toContain('await addBudget');
    expect(smart).toContain('if (ok) created');
    expect(smart).not.toContain('toCreate.forEach');
  });
});
