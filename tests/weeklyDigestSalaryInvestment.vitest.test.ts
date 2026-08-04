/**
 * Weekly digest salary-invest path — cash txs + settings must reach computeSalaryInvestmentKpis.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFinancialDataForWeeklyDigest } from '../services/digestFinancialData';
import { computeSalaryInvestmentKpis } from '../services/salaryInvestmentKpis';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function currentMonthDay(day: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(Math.min(28, Math.max(1, day))).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('weekly digest salary investment wiring', () => {
  it('edge function fetches cash transactions and settings with salary column fallback', () => {
    const src = read('supabase/functions/send-weekly-digest/index.ts');
    expect(src).toContain(".from('transactions')");
    expect(src).toContain('salary_investing_targets');
    expect(src).toContain('month_start_day');
    expect(src).toContain('hasSalaryInvestSignal');
    expect(src).toMatch(/select\('month_start_day'\)/);
  });

  it('digest builder maps cash txs + account roles into non-zero salary KPIs', () => {
    const data = buildFinancialDataForWeeklyDigest({
      accountsRaw: [
        {
          id: 'checking-1',
          name: 'Salary Checking',
          type: 'Checking',
          balance: 10000,
          currency: 'SAR',
          account_role: 'salary_receiving',
        },
        {
          id: 'broker-1',
          name: 'Broker',
          type: 'Investment',
          balance: 0,
          currency: 'SAR',
        },
      ],
      assetsRaw: [],
      liabilitiesRaw: [],
      portfoliosRaw: [
        {
          id: 'portfolio-1',
          name: 'Growth',
          account_id: 'broker-1',
          holdings: [{ id: 'h1', symbol: 'AAPL', asset_class: 'Stock' }],
        },
      ],
      commodityHoldingsRaw: [],
      investmentTransactionsRaw: [
        {
          id: 'dep-1',
          account_id: 'broker-1',
          linked_cash_account_id: 'checking-1',
          date: currentMonthDay(7),
          type: 'deposit',
          symbol: 'CASH',
          quantity: 0,
          price: 0,
          total: 4000,
          currency: 'SAR',
        },
      ],
      transactionsRaw: [
        {
          id: 'tx-salary',
          account_id: 'checking-1',
          amount: 12000,
          type: 'income',
          category: 'Salary',
          description: 'Monthly salary',
          date: currentMonthDay(5),
        },
      ],
      settingsRaw: {
        month_start_day: 1,
        salary_investing_targets: { monthlyInvestTargetSar: 5000, salarySourceAccountId: 'checking-1' },
      },
      wealthUltraUserRow: null,
      wealthUltraGlobalRow: null,
    });

    expect(data.transactions).toHaveLength(1);
    expect(data.accounts.find((a) => a.id === 'checking-1')?.accountRole).toBe('salary_receiving');
    expect(data.settings.salaryInvestmentTargets?.monthlyInvestTargetSar).toBe(5000);

    const kpis = computeSalaryInvestmentKpis(data, 3.75);
    expect(kpis?.hasSalarySignal).toBe(true);
    expect(kpis?.salaryIncomeSarMonth).toBe(12000);
    expect(kpis?.investedFromSalarySarMonth).toBe(4000);
  });
});
