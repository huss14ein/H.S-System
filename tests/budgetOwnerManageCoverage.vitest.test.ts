/**
 * Budget owner can manage rows; no silent auto-create on statement import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('budget owner manage & manual-only creation', () => {
  it('Budgets.tsx uses canManageBudgets for edit modal and card actions', () => {
    const src = read('pages/Budgets.tsx');
    expect(src).toContain('canManageBudgets');
    expect(src).toContain('isCollaborator');
    expect(src).toMatch(/handleOpenModal[\s\S]{0,400}canManageBudgets/);
    expect(src).not.toMatch(/handleOpenModal[\s\S]{0,80}if \(!isAdmin\) return/);
    expect(src).toContain('canDelete={canManageBudgets}');
    expect(src).toContain('Budgets are never created automatically');
  });

  it('statement import does not auto-create budget rows', () => {
    const src = read('pages/StatementUpload.tsx');
    expect(src).not.toContain('ensureBudgetRowExists');
    expect(src).not.toContain('ensureBudgetsForMappedTransactions');
  });

  it('month navigation does not call copyBudgets without user action', () => {
    const src = read('pages/Budgets.tsx');
    expect(src).not.toMatch(/changeMonth[\s\S]{0,200}copyBudgetsFromPreviousMonth/);
    expect(src).toContain('handleCopyBudgets');
  });

  it('Dashboard and Summary use reorganized layout (no ops cockpit / atlas on page)', () => {
    expect(read('pages/Dashboard.tsx')).not.toContain('DashboardOperationsCockpit');
    expect(read('pages/WealthAnalytics.tsx')).toContain('DashboardOperationsCockpit');
    expect(read('utils/lazyPages.tsx')).toContain("'Wealth Analytics'");
    expect(read('pages/Summary.tsx')).not.toContain('SummaryWealthAtlas');
    expect(read('pages/Dashboard.tsx')).toContain('dashboard-kpi-row');
    expect(read('pages/Dashboard.tsx')).not.toContain('CollapsibleSection');
    expect(read('pages/WealthAnalytics.tsx')).toContain('CollapsibleSection');
  });
});
