import { describe, expect, it } from 'vitest';
import { classifyIncomeTransaction, summarizeIncomeTaxonomy } from '../services/incomeTaxonomy';
import type { Transaction } from '../types';

describe('incomeTaxonomy', () => {
  it('classifies salary-like income', () => {
    const t: Transaction = {
      id: '1',
      date: '2026-01-15',
      description: 'Monthly payroll',
      amount: 5000,
      type: 'income',
      accountId: 'a1',
    };
    expect(classifyIncomeTransaction(t)).toBe('salary');
  });

  it('summarizes by label', () => {
    const rows = summarizeIncomeTaxonomy([
      { id: '1', date: '2026-01-01', description: 'payroll', amount: 100, type: 'income', accountId: 'a' },
      { id: '2', date: '2026-01-02', description: 'bonus', amount: 50, type: 'income', accountId: 'a' },
    ]);
    expect(rows.some((r) => r.label === 'salary' || r.label === 'bonus')).toBe(true);
  });
});
