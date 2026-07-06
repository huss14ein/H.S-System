/**
 * KSA product scope guards — no US/EU tax reporting surfaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('KSA product scope', () => {
  it('uses investment_cost_lots naming (not tax lots)', () => {
    expect(read('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql')).toContain(
      'investment_cost_lots',
    );
    expect(read('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql')).not.toContain(
      'investment_tax_lots',
    );
    expect(read('types.ts')).toContain('InvestmentCostLot');
  });

  it('new analytics surfaces avoid US tax-report strings', () => {
    const surfaces = [
      'pages/Analysis.tsx',
      'pages/WealthAnalytics.tsx',
      'components/spending/SpendingCommandCenter.tsx',
      'services/spendingReportExport.ts',
    ];
    for (const file of surfaces) {
      const src = read(file).toLowerCase();
      expect(src).not.toContain('1099');
      expect(src).not.toContain('wash sale');
      expect(src).not.toContain('tax report');
    }
  });

  it('corporate actions copy references KSA P/L not tax', () => {
    expect(read('components/investments/CorporateActionApplyPanel.tsx')).toContain('not tax');
    expect(read('services/corporateActionApply.ts')).toContain('KSA');
  });
});
