import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeGoalResolvedAmountsSar } from '../services/goalResolvedTotals';
import { buildFinancialDataForWeeklyDigest } from '../services/digestFinancialData';
import { computeWeeklyDigestPersonalNetWorthSar } from '../services/weeklyDigestNetWorthSar';
import { computePersonalHeadlineNetWorthSar } from '../services/personalNetWorth';
import { sukukPayoutScheduleToRow, sukukPayoutEventToRow } from '../services/sukuk/sukukPayoutDb';
import type { FinancialData, SukukPayoutEvent, SukukPayoutSchedule } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('sukuk investments E2E wiring', () => {
  it('weekly digest builder includes sukuk_positions exposure', () => {
    const data = buildFinancialDataForWeeklyDigest({
      accountsRaw: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 1000, currency: 'SAR' }],
      assetsRaw: [],
      liabilitiesRaw: [],
      portfoliosRaw: [],
      commodityHoldingsRaw: [],
      sukukPositionsRaw: [
        {
          id: 'sk1',
          name: 'Gov Sukuk',
          investment_account_id: 'a1',
          currency: 'SAR',
          face_value: 5000,
          outstanding_principal: 5000,
          issue_date: '2024-01-01',
          maturity_date: '2027-01-01',
          status: 'active',
        },
      ],
      investmentTransactionsRaw: [],
      wealthUltraUserRow: null,
      wealthUltraGlobalRow: null,
    });
    expect(data.sukukPositions).toHaveLength(1);
    expect(data.sukukPositions![0].outstandingPrincipal).toBe(5000);
  });

  it('goal resolved totals include linked active Sukuk positions', () => {
    const data = {
      accounts: [],
      assets: [],
      liabilities: [],
      goals: [{ id: 'g1', name: 'House', targetAmount: 100000, deadline: '2030-01-01', priority: 'High' }],
      sukukPositions: [
        {
          id: 'sk1',
          name: 'Sukuk',
          investmentAccountId: 'inv',
          currency: 'SAR',
          faceValue: 8000,
          outstandingPrincipal: 8000,
          issueDate: '2024-01-01',
          maturityDate: '2027-01-01',
          status: 'active',
          goalId: 'g1',
        },
      ],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const map = computeGoalResolvedAmountsSar(data, 3.75);
    expect(map.get('g1')).toBe(8000);
  });

  it('DataContext exposes saveSukukPayoutSchedule', () => {
    const src = read('context/DataContext.tsx');
    expect(src).toContain('saveSukukPayoutSchedule');
    expect(src).toContain('buildMaturityPrincipalEventDraft');
    expect(src).toContain('matureSukukDirectPosts');
  });

  it('SukukInvestmentsSection uses DataContext save (not direct supabase)', () => {
    const src = read('components/investments/SukukInvestmentsSection.tsx');
    expect(src).toContain('saveSukukPayoutSchedule');
    expect(src).not.toContain("from('sukuk_payout_schedules')");
    expect(src).not.toContain('asset_id');
  });

  it('weekly digest edge function fetches sukuk_positions', () => {
    const src = read('supabase/functions/send-weekly-digest/index.ts');
    expect(src).toContain("from('sukuk_positions')");
    expect(src).toContain('sukukPositionsRaw');
  });

  it('weekly digest NW includes direct Sukuk in headline path', () => {
    const data = buildFinancialDataForWeeklyDigest({
      accountsRaw: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 2000, currency: 'SAR' }],
      assetsRaw: [],
      liabilitiesRaw: [],
      portfoliosRaw: [],
      commodityHoldingsRaw: [],
      sukukPositionsRaw: [
        {
          id: 'sk1',
          name: 'Gov Sukuk',
          investment_account_id: 'a1',
          currency: 'SAR',
          face_value: 10000,
          outstanding_principal: 10000,
          issue_date: '2024-01-01',
          maturity_date: '2027-01-01',
          status: 'active',
        },
      ],
      investmentTransactionsRaw: [],
      wealthUltraUserRow: null,
      wealthUltraGlobalRow: null,
    });
    const fx = 3.75;
    const digestNw = computeWeeklyDigestPersonalNetWorthSar(data, fx);
    const headline = computePersonalHeadlineNetWorthSar(data, fx);
    expect(digestNw).toBe(headline.netWorth);
    expect(digestNw).toBe(12000);
  });

  it('backup restore maps Sukuk rows to snake_case DB columns', () => {
    const schedule: SukukPayoutSchedule = {
      id: 'sch1',
      sukukPositionId: 'pos1',
      investmentAccountId: 'acc1',
      currency: 'SAR',
      cadence: 'maturity_only',
      enabled: true,
    };
    const event: SukukPayoutEvent = {
      id: 'ev1',
      scheduleId: 'sch1',
      sukukPositionId: 'pos1',
      investmentAccountId: 'acc1',
      kind: 'principal',
      payoutDate: '2027-01-01',
      amount: 5000,
      currency: 'SAR',
      posted: false,
    };
    expect(sukukPayoutScheduleToRow(schedule)).toMatchObject({
      sukuk_position_id: 'pos1',
      investment_account_id: 'acc1',
    });
    expect(sukukPayoutEventToRow(event)).toMatchObject({
      schedule_id: 'sch1',
      sukuk_position_id: 'pos1',
      payout_date: '2027-01-01',
    });
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('sukukPayoutScheduleToRow');
    expect(ctx).toContain('sukukPayoutEventToRow');
  });

  it('Investments AI meta includes direct Sukuk SAR', () => {
    const src = read('services/geminiService.ts');
    expect(src).toContain('sukukPositionsValueSAR');
    expect(src).toContain('Direct Sukuk contracts');
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('sukukPositionsValueSAR');
  });
});
