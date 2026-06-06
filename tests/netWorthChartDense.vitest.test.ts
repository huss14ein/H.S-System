import { describe, it, expect } from 'vitest';
import {
    forwardFillDailyNetWorthRows,
    inheritBucketsWhenMissing,
    buildNetWorthTrendSeriesFromSnapshots,
    carryForwardInvalidNetWorthSnapshots,
} from '../services/netWorthChartDense';

describe('netWorthChartDense', () => {
    it('forward-fills missing calendar days with previous amounts', () => {
        const sparse = [
            {
                date: '2026-01-01T12:00:00.000Z',
                dayKey: '2026-01-01',
                name: 'Jan 1',
                'Net Worth': 1000,
                Cash: 400,
                Investments: 600,
                Physical: 0,
                Receivables: 0,
                Liabilities: 0,
            },
            {
                date: '2026-01-03T12:00:00.000Z',
                dayKey: '2026-01-03',
                name: 'Jan 3',
                'Net Worth': 1100,
                Cash: 500,
                Investments: 600,
                Physical: 0,
                Receivables: 0,
                Liabilities: 0,
            },
        ];
        const dense = forwardFillDailyNetWorthRows(sparse);
        expect(dense).toHaveLength(3);
        const jan2 = dense.find((r) => r.dayKey === '2026-01-02');
        expect(jan2).toBeDefined();
        expect(jan2!['Net Worth']).toBe(1000);
        expect(jan2!.Cash).toBe(400);
    });

    it('scales prior buckets when net worth exists but bucket stack is empty', () => {
        const rows = [
            {
                date: '2026-01-01T12:00:00.000Z',
                dayKey: '2026-01-01',
                name: 'Jan 1',
                'Net Worth': 1000,
                Cash: 1000,
                Investments: 0,
                Physical: 0,
                Receivables: 0,
                Liabilities: 0,
            },
            {
                date: '2026-01-02T12:00:00.000Z',
                dayKey: '2026-01-02',
                name: 'Jan 2',
                'Net Worth': 2000,
                Cash: 0,
                Investments: 0,
                Physical: 0,
                Receivables: 0,
                Liabilities: 0,
            },
        ];
        const out = inheritBucketsWhenMissing(rows);
        expect(out[1]!.Cash).toBe(2000);
        expect(out[1]!['Net Worth']).toBe(2000);
    });

    it('carryForwardInvalidNetWorthSnapshots replaces zero with previous good level', () => {
        const rows = [
            { dayKey: '2026-04-14', netWorth: 1_200_000 },
            { dayKey: '2026-04-15', netWorth: 0 },
            { dayKey: '2026-04-16', netWorth: 1_210_000 },
        ];
        const out = carryForwardInvalidNetWorthSnapshots(rows);
        expect(out[1]!.netWorth).toBe(1_200_000);
        expect(out[2]!.netWorth).toBe(1_210_000);
    });

    it('buildNetWorthTrendSeriesFromSnapshots forward-fills missing days and never plots zero gaps', () => {
        const sparse = [
            { dayKey: '2026-04-14', netWorth: 1_200_000 },
            { dayKey: '2026-04-16', netWorth: 0 },
            { dayKey: '2026-04-18', netWorth: 1_250_000 },
        ];
        const dense = buildNetWorthTrendSeriesFromSnapshots(sparse);
        expect(dense.find((r) => r.dayKey === '2026-04-15')?.netWorth).toBe(1_200_000);
        expect(dense.find((r) => r.dayKey === '2026-04-16')?.netWorth).toBe(1_200_000);
        expect(dense.find((r) => r.dayKey === '2026-04-17')?.netWorth).toBe(1_200_000);
        expect(dense.every((r) => r.netWorth > 0)).toBe(true);
    });
});
