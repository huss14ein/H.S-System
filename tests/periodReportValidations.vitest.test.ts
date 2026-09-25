/**
 * Unit tests for period report validations + installment helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  financialMonthKeysCoveringRange,
  validateCustomPeriodRange,
  validatePeriodReportRequest,
  resolvePeriodReportWindow,
} from '../services/periodReportWindow';
import { filterInstallmentsInWindow } from '../services/periodReportInstallments';

describe('period report validations', () => {
  const now = new Date('2026-06-15T12:00:00');

  it('requires both custom dates', () => {
    expect(validateCustomPeriodRange('', '2026-01-31').ok).toBe(false);
    expect(validateCustomPeriodRange('2026-01-01', '').ok).toBe(false);
  });

  it('rejects inverted / oversized / future / ancient ranges', () => {
    expect(validateCustomPeriodRange('2026-02-01', '2026-01-01', { now }).ok).toBe(false);
    expect(validateCustomPeriodRange('2010-01-01', '2018-01-01', { now }).ok).toBe(false);
    expect(validateCustomPeriodRange('2026-01-01', '2030-01-01', { now }).ok).toBe(false);
    expect(validateCustomPeriodRange('2000-01-01', '2000-06-01', { now }).ok).toBe(false);
    expect(validateCustomPeriodRange('2026-01-01', '2026-03-31', { now }).ok).toBe(true);
  });

  it('validatePeriodReportRequest gates data + preset + custom', () => {
    expect(validatePeriodReportRequest({ hasData: false, preset: 'YTD' }).ok).toBe(false);
    expect(validatePeriodReportRequest({ hasData: true, preset: 'YTD' }).ok).toBe(true);
    expect(
      validatePeriodReportRequest({
        hasData: true,
        preset: 'custom',
        customStartIso: '2026-01-01',
        customEndIso: '2026-02-01',
        now,
      }).ok,
    ).toBe(true);
    expect(
      validatePeriodReportRequest({
        hasData: true,
        preset: 'custom',
        customStartIso: '',
        customEndIso: '2026-02-01',
        now,
      }).ok,
    ).toBe(false);
  });

  it('CY/custom always produce finKeys', () => {
    const cy = resolvePeriodReportWindow({ preset: 'CY', monthStartDay: 1, now });
    expect(cy.finKeys.length).toBeGreaterThan(0);
    const custom = resolvePeriodReportWindow({
      preset: 'custom',
      monthStartDay: 25,
      now,
      customStartIso: '2026-01-01',
      customEndIso: '2026-04-15',
    });
    expect(custom.finKeys.length).toBeGreaterThanOrEqual(3);
    expect(financialMonthKeysCoveringRange(custom.start, custom.end, 25)).toEqual(custom.finKeys);
  });
});

describe('filterInstallmentsInWindow', () => {
  it('filters inclusive by due date', () => {
    const rows = [
      { id: '1', planId: 'p', planName: 'A', sequence: 1, dueDate: '2026-01-15', amount: 100, currency: 'SAR', status: 'SCHEDULED', paidAt: null },
      { id: '2', planId: 'p', planName: 'A', sequence: 2, dueDate: '2026-02-15', amount: 100, currency: 'SAR', status: 'PAID', paidAt: '2026-02-10' },
      { id: '3', planId: 'p', planName: 'A', sequence: 3, dueDate: '2026-03-15', amount: 100, currency: 'SAR', status: 'SCHEDULED', paidAt: null },
    ];
    expect(filterInstallmentsInWindow(rows, '2026-02-01', '2026-02-28').map((r) => r.id)).toEqual(['2']);
  });
});
